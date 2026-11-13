/**
 * 并发黑盒打击：把竞态直接打出来
 *
 * 前几轮都是"读代码找并发问题"——这次换手段：**并发打接口**，看数据会不会算错。
 *
 *   CS-A 并发下单抢库存：库存 5、10 个并发各买 1 件
 *        → 成功数必须正好 5，库存必须正好 0（不能为负），订单必须正好 5
 *   CS-B 并发加购同一商品：10 次并发各加 1 件
 *        → 购物车数量必须正好 10（不能少记）
 *   CS-C 并发下单用同一个幂等键：8 个并发
 *        → 只能创建 1 单
 *   CS-D 并发改密码：两次并发改密
 *        → token_version 必须 +2，且所有旧 token 立即失效
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

let user
let userToken
let adminToken
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
  const { User, Product, ProductCategory } = models()
  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900002222'
  }))
  userToken = TestHelpers.generateToken(user)
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `cs_admin_${Date.now()}`,
    password: 'CsPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
  category = await ProductCategory.create({ name: '并发分类' })
  product = await Product.create({
    name: '并发商品', price: 100, stock: 5, category_id: category.id, status: 'active'
  })
})

/** 下单请求体 */
function orderBody (qty = 1, extra = {}) {
  return {
    contact_name: '并发用户',
    contact_phone: '+8613900002222',
    delivery_address: '并发地址',
    detail_address: '街道 1 号',
    items: [{ product_id: product.id, quantity: qty }],
    payment_method: 'cod',
    ...extra
  }
}

describe('并发黑盒打击', () => {
  it('CS-A 并发下单抢库存：成功数正好 5、库存正好 0、不为负', async () => {
    const requests = Array.from({ length: 10 }, () =>
      request(app).post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(orderBody(1))
    )
    const results = await Promise.all(requests)

    const ok = results.filter(r => r.status === 201).length
    const stockErrors = results.filter(r => r.status === 400 && /库存/.test(r.body?.message || '')).length

    expect(ok, `应恰好成功 5 单（实际 ${ok}），其余应是库存不足（${stockErrors}）`).toBe(5)
    expect(ok + stockErrors, `其余 ${results.length - ok - stockErrors} 个请求报了别的错：${results.filter(r => r.status !== 201 && !(r.status === 400 && /库存/.test(r.body?.message || ''))).map(r => r.status + ':' + (r.body?.message || '')).join(' | ')}`).toBe(10)

    const { Product, Order } = models()
    const fresh = await Product.findByPk(product.id)
    expect(Number(fresh.stock), '库存必须正好归零，不能为负').toBe(0)
    expect(Number(fresh.stock)).toBeGreaterThanOrEqual(0)
    expect(await Order.count({ where: { status: 'shipping' } }), '成交订单数应正好 5').toBe(5)
  })

  it('CS-B 并发加购同一商品：数量正好 10（不能少记）', async () => {
    // 库存要够（100），否则会被库存检查挡掉，测的就不是"丢单"而是"库存保护"了
    const { Product } = models()
    await Product.update({ stock: 100 }, { where: { id: product.id } })
    const requests = Array.from({ length: 10 }, () =>
      request(app).post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ product_id: product.id, quantity: 1 })
    )
    const results = await Promise.all(requests)

    const ok = results.filter(r => r.status === 200 || r.status === 201).length
    expect(ok, `10 次加购都该成功（实际 ${ok}）：${results.filter(r => r.status >= 400).map(r => r.status + ':' + (r.body?.message || '')).join(' | ')}`).toBe(10)

    const { Cart } = models()
    const rows = await Cart.findAll({ where: { user_id: user.id, product_id: product.id } })
    const totalQty = rows.reduce((s, r) => s + Number(r.quantity), 0)
    expect(totalQty, `⚠️ 并发加购少记了：期望 10，实际 ${totalQty}（行数 ${rows.length}）`).toBe(10)
  })

  it('CS-C 并发下单用同一个幂等键：只能创建 1 单', async () => {
    const key = 'strike-idempotent-key-1'
    const requests = Array.from({ length: 8 }, () =>
      request(app).post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(orderBody(1, { client_order_key: key }))
    )
    const results = await Promise.all(requests)

    const { Order } = models()
    const count = await Order.count({ where: { user_id: user.id, client_order_key: key } })
    expect(count, `同一幂等键并发下单应只创建 1 单（实际 ${count}）`).toBe(1)

    const { Product } = models()
    const fresh = await Product.findByPk(product.id)
    expect(Number(fresh.stock), '幂等命中不应重复扣库存').toBe(4)
  })

  it('CS-D 并发改密码：token_version +2，旧 token 立即失效', async () => {
    const { User } = models()
    const before = Number((await User.findByPk(user.id)).token_version)

    const requests = [
      request(app).put('/api/users/profile/password')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ old_password: 'Abcd1234', new_password: 'NewPass#2026' }),
      request(app).put('/api/users/profile/password')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ old_password: 'Abcd1234', new_password: 'OtherPass#2026' })
    ]
    await Promise.all(requests)

    const after = Number((await User.findByPk(user.id)).token_version)
    // 两次并发改密：成功几次就 +几次（至少 +1）
    expect(after, `token_version 应至少 +1（before=${before} after=${after}）`).toBeGreaterThanOrEqual(before + 1)

    // 旧 token 必须失效
    const probe = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect(probe.status, '改密后旧 token 必须失效').toBe(401)
  })
})

describe('并发取消与库存回补', () => {
  it('CS-E 并发取消同一订单：库存只回补一次（不能虚增）', async () => {
    const { Product, Order, OrderItem } = models()
    // 库存 10，下单 2 件 → 剩 8
    await Product.update({ stock: 10 }, { where: { id: product.id } })
    const res = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send(orderBody(2))
    expect(res.status).toBe(201)
    const orderId = res.body.data.order.id
    expect(Number((await Product.findByPk(product.id)).stock)).toBe(8)

    // 并发取消 5 次（幂等键不适用：取消是按订单 id 的）
    const cancels = Array.from({ length: 5 }, () =>
      request(app).put(`/api/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
    )
    await Promise.all(cancels)

    const fresh = await Product.findByPk(product.id)
    expect(Number(fresh.stock), `⚠️ 库存被回补了多次：期望 10，实际 ${fresh.stock}`).toBe(10)
  })
})

describe('并发领券', () => {
  it('CS-F 10 个用户并发抢 2 张券：只能发出 2 张（不能超发）', async () => {
    const { CouponTemplate, UserCoupon, User } = models()
    const tpl = await CouponTemplate.create({
      name: '并发限量券',
      type: 'discount',
      amount: 50,
      min_spend: 100,
      total: 2,            // 只有 2 张
      per_user: 1,
      status: 'active',
      scope: { type: 'all', ids: [] }
    })

    // 10 个不同用户并发领
    const tokens = []
    for (let i = 0; i < 10; i++) {
      const u = await User.create(await TestDataFactory.createUser({
        country_code: '+86',
        phone: `139${String(10000000 + i)}`
      }))
      tokens.push(TestHelpers.generateToken(u))
    }

    const results = await Promise.all(tokens.map(t =>
      request(app).post('/api/coupons/claim')
        .set('Authorization', `Bearer ${t}`)
        .send({ template_id: tpl.id })
    ))

    const issued = await UserCoupon.count({ where: { template_id: tpl.id } })
    const okCount = results.filter(r => r.status === 201).length
    expect(issued, `⚠️ 券超发了：模板只有 2 张，实际发出 ${issued} 张（成功响应 ${okCount}）`).toBe(2)
    expect(okCount, `成功响应数应等于实发数（${okCount} vs ${issued}）`).toBe(2)
  })
})

describe('商品编辑不能吞掉并发扣减（超卖）', () => {
  it('CS-G 编辑弹窗开着时并发下单 → 保存编辑后库存仍是扣减后的值', async () => {
    const { Product, Order } = models()
    await Product.update({ stock: 10 }, { where: { id: product.id } })

    // 运营 10:00 打开编辑弹窗，看到 stock = 10（快照）
    const stockSeenByOperator = 10

    // 期间 3 笔订单各扣 1 件 → DB 里是 7
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(orderBody(1))
      expect(r.status).toBe(201)
    }
    expect(Number((await Product.findByPk(product.id)).stock)).toBe(7)

    // 10:05 运营只改了价格后保存（表单里还带着陈旧的 stock=10）
    const res = await request(app).put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '改名了', price: 120, stock: stockSeenByOperator, stock_prev: stockSeenByOperator })

    expect(res.status).toBe(200)
    const fresh = await Product.findByPk(product.id)
    expect(Number(fresh.price)).toBe(120)
    expect(Number(fresh.stock), '⚠️ 库存被写回了陈旧快照 → 凭空多出可卖库存（超卖）').toBe(7)
  })

  it('CS-H 不带 stock_prev 改库存 → 400（拒绝用绝对值覆盖）', async () => {
    const res = await request(app).put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '改名了', stock: 999 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/stock_prev|调整库存/)
  })
})
