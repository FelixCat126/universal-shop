/**
 * P5 游客直接下单端到端测试（20 用例）
 *
 * 业务链：未登录浏览 → 匿名购物车 → 下单自动注册/复用账号 → 返回 token →
 *   查单/支付/改密前置状态 → 后台取消与库存/积分一致性。
 *
 * 重点：
 *   - 游客账号复用（must_reset_password=true 的首单失败重试/再次下单）
 *   - 订单幂等键 deduplicated 与并发同手机号唯一约束兜底
 *   - 订单/用户/地址/库存/积分/购物车的一致性
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  // 与生产 app.js ensureClientOrderKeyIndex 对齐：测试 syncModels 不建该部分唯一索引，须在此补齐
  await TestDatabase.getSequelize().query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_user_client_key ON orders (user_id, client_order_key) WHERE client_order_key IS NOT NULL'
  )
  _clearAuthCacheForTests()
  _resetLoginGuardForTests()
})

const models = () => TestDatabase.getSequelize().models

async function activeProduct (overrides = {}) {
  const { Product, ProductCategory } = models()
  const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
  return Product.create(
    TestDataFactory.createProduct({
      stock: 100,
      status: 'active',
      price: 100,
      discount: null,
      category_id: cat.id,
      ...overrides
    })
  )
}

async function makeUser (overrides = {}) {
  const { User } = models()
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
}

async function adminToken () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return TestHelpers.generateAdminToken(admin)
}

function guestOrderBody (product, overrides = {}) {
  return {
    items: [{ product_id: product.id, quantity: 1 }],
    contact_name: '游客测试',
    contact_phone: `+86${TestHelpers.generatePhoneNumber('+86')}`,
    delivery_address: '测试收货地址',
    province: '曼谷',
    city: '曼谷',
    district: 'Pathum Wan',
    detail_address: '123 Test Road',
    postal_code: '10330',
    payment_method: 'cod',
    ...overrides
  }
}

async function postGuestOrder (product, overrides = {}) {
  return request(app).post('/api/orders').send(guestOrderBody(product, overrides))
}

describe('P5-GuestOrder.happy.cod', () => {
  it('G-01 游客 COD 完整链路：浏览 → 匿名加购 → 下单 → token 查单/资料 → 数据一致', async () => {
    await seedSystemConfigBaseline({ points_earn_rate: '0.01' })
    const product = await activeProduct({ stock: 10, price: 100 })

    // 1. 未登录浏览商品
    const catalog = await request(app).get('/api/products')
    expect(catalog.status).toBe(200)
    expect(catalog.body.data.products.length).toBeGreaterThan(0)

    // 2. 匿名加购（session-id）
    const add = await request(app).post('/api/cart')
      .set('Session-ID', 'guest-e2e-1')
      .send({ product_id: product.id, quantity: 2 })
    expect(add.status).toBe(200)

    const cart = await request(app).get('/api/cart').set('Session-ID', 'guest-e2e-1')
    expect(cart.body.data.length).toBe(1)
    expect(cart.body.data[0].quantity).toBe(2)

    // 3. 下单（clear_cart）
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    const create = await postGuestOrder(product, {
      contact_phone: phone,
      clear_cart: true,
      items: [{ product_id: product.id, quantity: 2 }]
    })
    expect(create.status).toBe(201)
    expect(create.body.data.autoRegistered).toBe(true)
    expect(create.body.data.token).toBeTruthy()
    expect(create.body.data.user.must_reset_password).toBe(true)

    const order = create.body.data.order
    expect(order.status).toBe('shipping') // COD 初始即 shipping
    expect(order.contact_phone).toBe(phone)
    expect(order.delivery_address).toContain('曼谷')
    expect(order.delivery_address).toContain('Pathum Wan')
    expect(order.delivery_address).toContain('10330')
    expect(Number(order.total_amount_thb)).toBe(200)

    const token = create.body.data.token
    const userId = create.body.data.user.id

    // 4. 用户 / 地址 / 库存 / 购物车 / 积分一致性
    const { User, Address, Product, Cart, UserPointBalance } = models()
    const user = await User.findByPk(userId)
    expect(user.country_code).toBe('+86')
    expect(user.username).toBe(phone.slice(3))
    expect(user.must_reset_password).toBe(true)

    const addresses = await Address.findAll({ where: { user_id: userId } })
    expect(addresses.length).toBe(1)
    expect(addresses[0].is_default).toBe(true)
    expect(addresses[0].contact_country_code).toBe('+86')
    expect(addresses[0].postal_code).toBe('10330')

    const freshProduct = await Product.findByPk(product.id)
    expect(freshProduct.stock).toBe(8)

    const cartAfter = await Cart.findAll({ where: { user_id: userId } })
    expect(cartAfter.length).toBe(0)

    const balance = await UserPointBalance.findOne({ where: { user_id: userId } })
    expect(Number(balance?.balance || 0)).toBe(2) // floor(200 * 0.01)

    // 5. 用返回 token 查订单列表 / 详情 / profile
    const list = await request(app).get('/api/orders').set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    expect(list.body.data.orders.length).toBe(1)

    const detail = await request(app).get(`/api/orders/${order.id}`).set('Authorization', `Bearer ${token}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.order_no).toBe(order.order_no)
    expect(detail.body.data.items.length).toBe(1)

    const profile = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`)
    expect(profile.status).toBe(200)
    expect(profile.body.data.must_reset_password).toBe(true)
  })
})

describe('P5-GuestOrder.happy.online', () => {
  it('G-02 游客 online 下单 → pending → 用 token 确认支付 → shipping + 积分；二次确认幂等', async () => {
    await seedSystemConfigBaseline({ points_earn_rate: '0.01' })
    const product = await activeProduct({ price: 100 })
    const create = await postGuestOrder(product, { payment_method: 'online' })
    expect(create.status).toBe(201)
    expect(create.body.data.order.status).toBe('pending')
    const token = create.body.data.token
    const userId = create.body.data.user.id
    const orderId = create.body.data.order.id

    const confirm = await request(app).post(`/api/orders/${orderId}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirm.status).toBe(200)

    const { Order, UserPointBalance } = models()
    const after = await Order.findByPk(orderId)
    expect(after.status).toBe('shipping')
    expect(after.online_paid_at).toBeTruthy()
    expect(Number((await UserPointBalance.findOne({ where: { user_id: userId } })).balance)).toBe(1)

    // 二次确认：不再重复发积分
    const confirm2 = await request(app).post(`/api/orders/${orderId}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirm2.status).toBe(200)
    expect(Number((await UserPointBalance.findOne({ where: { user_id: userId } })).balance)).toBe(1)
  })
})

describe('P5-GuestOrder.accountReuse', () => {
  it('G-03 同游客手机号再次下单：复用自动注册账号，不重复创建用户', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`

    const first = await postGuestOrder(product, { contact_phone: phone })
    expect(first.status).toBe(201)
    const userId = first.body.data.user.id

    const second = await postGuestOrder(product, { contact_phone: phone })
    expect(second.status).toBe(201)
    expect(second.body.data.user.id).toBe(userId)

    const { User, Order } = models()
    expect(await User.count({ where: { phone: phone.slice(3) } })).toBe(1)
    expect(await Order.count({ where: { user_id: userId } })).toBe(2)
  })

  it('G-04 正常注册手机号被游客用于下单 → 400，不自动复用', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser({ must_reset_password: false })
    const product = await activeProduct()
    const res = await postGuestOrder(product, { contact_phone: `+86${user.phone}` })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/已被注册/)
  })

  it('G-05 被禁用手机号游客下单 → 400 禁用提示', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser({ is_active: false })
    const product = await activeProduct()
    const res = await postGuestOrder(product, { contact_phone: `+86${user.phone}` })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/禁用/)
  })
})

describe('P5-GuestOrder.phoneAndValidation', () => {
  it('G-06 手机号不带区号默认 +66（泰国 9 位）', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    const res = await postGuestOrder(product, { contact_phone: '812345678' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.country_code).toBe('+66')
    expect(res.body.data.user.phone).toBe('812345678')
  })

  it('G-07 支持 +60 马来西亚手机号（9 位）', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    const res = await postGuestOrder(product, { contact_phone: '+60123456789' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.country_code).toBe('+60')
    expect(res.body.data.user.phone).toBe('123456789')
  })

  it('G-08 非法手机号（字母 / 0 开头 / 过短）→ 400，不创建订单', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    for (const bad of ['abc12345678', '+8608123456789', '+86123']) {
      const res = await postGuestOrder(product, { contact_phone: bad })
      expect(res.status).toBe(400)
    }
    const { Order } = models()
    expect(await Order.count()).toBe(0)
  })

  it('G-09 缺收货信息 → 400，且不创建游客用户/订单', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    const res = await request(app).post('/api/orders').send({
      items: [{ product_id: product.id, quantity: 1 }],
      contact_phone: `+86${TestHelpers.generatePhoneNumber('+86')}`,
      delivery_address: 'A'
    })
    expect(res.status).toBe(400)
    const { User, Order } = models()
    expect(await User.count()).toBe(0)
    expect(await Order.count()).toBe(0)
  })

  it('G-10 库存不足 → 400，订单不落库、库存不变；游客账号按当前实现可能已创建', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ stock: 0 })
    const res = await postGuestOrder(product)
    expect(res.status).toBe(400)
    const { Order, Product } = models()
    expect(await Order.count()).toBe(0)
    expect((await Product.findByPk(product.id)).stock).toBe(0)
  })

  it('G-11 游客 points 支付 → 401，不创建用户/订单', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ points: 10 })
    const res = await postGuestOrder(product, { payment_method: 'points' })
    expect(res.status).toBe(401)
    const { User, Order } = models()
    expect(await User.count()).toBe(0)
    expect(await Order.count()).toBe(0)
  })
})

describe('P5-GuestOrder.idempotency', () => {
  it('G-12 同游客同 client_order_key 重复提交 → 同订单 deduplicated，库存只扣一次', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ stock: 10 })
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    const key = `guest-key-${Date.now()}`

    const first = await postGuestOrder(product, { contact_phone: phone, client_order_key: key })
    expect(first.status).toBe(201)
    const second = await postGuestOrder(product, { contact_phone: phone, client_order_key: key })
    expect(second.status).toBe(201)
    expect(second.body.data.deduplicated).toBe(true)
    expect(second.body.data.order.id).toBe(first.body.data.order.id)

    const { Order, Product } = models()
    expect(await Order.count()).toBe(1)
    expect((await Product.findByPk(product.id)).stock).toBe(9)
  })

  it('G-13 同游客手机号并发下单（无幂等键）→ 账号唯一、库存不超卖', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ stock: 3 })
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    const N = 6
    const results = await Promise.all(
      Array.from({ length: N }, () => postGuestOrder(product, { contact_phone: phone }))
    )
    const ok = results.filter((r) => r.status === 201).length
    expect(ok).toBeLessThanOrEqual(3)

    const { User, Product, Order } = models()
    expect(await User.count({ where: { phone: phone.slice(3) } })).toBe(1)
    expect(await Order.count()).toBe(ok)
    expect((await Product.findByPk(product.id)).stock).toBe(3 - ok)
    expect((await Product.findByPk(product.id)).stock).toBeGreaterThanOrEqual(0)
  })

  it('G-14 同游客手机号同幂等键并发 → 同订单，库存只扣一次', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ stock: 10 })
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    const key = `guest-race-${Date.now()}`
    const results = await Promise.all(
      Array.from({ length: 4 }, () => postGuestOrder(product, { contact_phone: phone, client_order_key: key }))
    )
    const ok = results.filter((r) => r.status === 201)
    expect(ok.length).toBeGreaterThanOrEqual(1)
    const ids = new Set(ok.map((r) => r.body.data.order.id))
    expect(ids.size).toBe(1)

    const { Order, Product } = models()
    expect(await Order.count()).toBe(1)
    expect((await Product.findByPk(product.id)).stock).toBe(9)
  })
})

describe('P5-GuestOrder.fxAndAddressAndRetry', () => {
  it('G-15 游客 USD 下单：外币金额 + THB 快照 + 汇率快照，后续改汇率不影响历史单', async () => {
    await seedSystemConfigBaseline({ exchange_rates: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })
    const product = await activeProduct({ price: 100 })
    const create = await postGuestOrder(product, { checkout_currency: 'USD' })
    expect(create.status).toBe(201)
    expect(create.body.data.order.currency_code).toBe('USD')
    expect(Number(create.body.data.order.total_amount)).toBe(3)
    expect(Number(create.body.data.order.total_amount_thb)).toBe(100)
    expect(Number(create.body.data.order.exchange_rate)).toBeCloseTo(0.03, 5)

    const { Order, SystemConfig } = models()
    await SystemConfig.setConfig('exchange_rates', { USD: '0.05', CNY: '0.20', MYR: '0.13' }, 'json')
    const fresh = await Order.findByPk(create.body.data.order.id)
    expect(Number(fresh.exchange_rate)).toBeCloseTo(0.03, 5)
  })

  it('G-16 游客分字段地址组装：订单与默认地址均含省/市/区/详情/邮编', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    const create = await postGuestOrder(product)
    expect(create.status).toBe(201)
    expect(create.body.data.order.province).toBe('曼谷')
    expect(create.body.data.order.city).toBe('曼谷')
    expect(create.body.data.order.district).toBe('Pathum Wan')
    expect(create.body.data.order.postal_code).toBe('10330')
    expect(create.body.data.order.delivery_address).toBe('曼谷 曼谷 Pathum Wan 123 Test Road 10330')
  })

  it('G-17 游客推荐码保存 referred_by_code', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct()
    const create = await postGuestOrder(product, { referral_code: 'abc12345' })
    expect(create.status).toBe(201)
    const { User } = models()
    const user = await User.findByPk(create.body.data.user.id)
    expect(user.referred_by_code).toBe('ABC12345')
  })

  it('G-18 首单库存不足失败 → 补库存后同手机号重试成功（账号复用）', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ stock: 0 })
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    const first = await postGuestOrder(product, { contact_phone: phone })
    expect(first.status).toBe(400)

    await product.update({ stock: 5 })
    const second = await postGuestOrder(product, { contact_phone: phone })
    expect(second.status).toBe(201)

    const { User, Order } = models()
    expect(await User.count({ where: { phone: phone.slice(3) } })).toBe(1)
    expect(await Order.count()).toBe(1)
  })

  it('G-19 游客 COD 订单被 admin 取消：库存回补、购物积分收回、账号与地址保留', async () => {
    await seedSystemConfigBaseline({ points_earn_rate: '0.01' })
    const product = await activeProduct({ stock: 10, price: 100 })
    const create = await postGuestOrder(product, { items: [{ product_id: product.id, quantity: 2 }] })
    expect(create.status).toBe(201)
    const orderId = create.body.data.order.id
    const userId = create.body.data.user.id
    const admin = await adminToken()

    const cancel = await request(app).put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'cancelled' })
    expect(cancel.status).toBe(200)

    const { Product, UserPointBalance, User, Address } = models()
    expect((await Product.findByPk(product.id)).stock).toBe(10)
    expect(Number((await UserPointBalance.findOne({ where: { user_id: userId } })).balance)).toBe(0)
    expect(await User.findByPk(userId)).not.toBeNull()
    expect(await Address.count({ where: { user_id: userId } })).toBe(1)
  })

  it('G-20 游客 quoteOrder 只试算不落库：不创建用户/订单/扣库存', async () => {
    await seedSystemConfigBaseline()
    const product = await activeProduct({ price: 100 })
    const res = await request(app).post('/api/orders/quote').send({
      items: [{ product_id: product.id, quantity: 2 }],
      payment_method: 'cod',
      checkout_currency: 'THB'
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const { User, Order, Product } = models()
    expect(await User.count()).toBe(0)
    expect(await Order.count()).toBe(0)
    expect((await Product.findByPk(product.id)).stock).toBe(100)
  })
})
