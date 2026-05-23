/**
 * P1 用户面 — 下单主流程 + 边界（17 用例，今天踩坑全在此）
 *
 *   happy 5：
 *     OC-1  登录 COD 下单 → 201
 *     OC-2  登录 online 下单 → 201 + status=pending
 *     OC-3  登录 points 下单（商品 points=10、余额够）→ 201 + 扣积分
 *     OC-4  游客 COD 下单（自动注册 + 返回 token）→ 201
 *     OC-5  clear_cart=true → 下单后购物车被清空
 *
 *   referral_code 边界 5：
 *     OC-6  referral_code='' → 视为未填，201
 *     OC-7  referral_code=null → 视为未填，201
 *     OC-8  referral_code='ab'（短）→ 400 VALIDATION_ERROR
 *     OC-9  referral_code='中文长'（非 alphanum）→ 400 VALIDATION_ERROR
 *     OC-10 referral_code='abc12345' 合法 → 201
 *
 *   币种 3（今天的真实坑）：
 *     OC-11 checkout_currency='CNY' + 配置 CNY=0 → 400 提示未配置
 *     OC-12 checkout_currency='USD' + 配置 USD=0.03 → 201
 *     OC-13 checkout_currency 缺失 → 默认 THB → 201
 *
 *   数据 4：
 *     OC-14 product_id 不存在 → 400
 *     OC-15 库存=0 → 400
 *     OC-16 quantity 超 5000 → 400 VALIDATION_ERROR
 *     OC-17 缺 contact_phone → 400 VALIDATION_ERROR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

async function userWithToken (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const u = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      ...overrides
    })
  )
  return { user: u, token: TestHelpers.generateToken(u) }
}

async function activeProduct (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Product } = sequelize.models
  return Product.create(
    TestDataFactory.createProduct({ stock: 50, status: 'active', price: 100, ...overrides })
  )
}

const BODY = {
  contact_name: '收货人',
  contact_phone: '+8613900000777',
  delivery_address: '某街区 1 号'
}

describe('P1.portal.order.create — happy', () => {
  it('OC-1 登录 COD 下单 → 201', async () => {
    await seedSystemConfigBaseline()
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 2 }], payment_method: 'cod' })
    expect(res.status).toBe(201)
    expect(res.body.data.order.payment_method).toBe('cod')
    expect(res.body.data.order.status).toBe('shipping') // COD 直接进入 shipping
  })

  it('OC-2 登录 online 下单 → 201 + status=pending', async () => {
    await seedSystemConfigBaseline()
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], payment_method: 'online' })
    expect(res.status).toBe(201)
    expect(res.body.data.order.payment_method).toBe('online')
    expect(res.body.data.order.status).toBe('pending')
  })

  it('OC-3 登录 points 下单（商品 points=10、余额 50）→ 201 + 扣积分', async () => {
    await seedSystemConfigBaseline()
    const { user, token } = await userWithToken()
    const p = await activeProduct({ points: 10 })
    await TestHelpers.topUpUserPoints(user, 50)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 2 }], payment_method: 'points' })
    expect(res.status).toBe(201)
    expect(res.body.data.order.payment_method).toBe('points')

    const sequelize = TestDatabase.getSequelize()
    const { UserPointBalance } = sequelize.models
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(bal.balance)).toBe(50 - 20) // 2*10
  })

  it('OC-4 游客 COD 下单（自动注册）→ 201', async () => {
    await seedSystemConfigBaseline()
    const p = await activeProduct()
    const res = await request(app)
      .post('/api/orders')
      .send({
        contact_name: '游客',
        contact_phone: '+8613911223344',
        delivery_address: '游客地址',
        detail_address: '街道 1 号',
        items: [{ product_id: p.id, quantity: 1 }],
        payment_method: 'cod'
      })
    expect(res.status).toBe(201)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.autoRegistered).toBe(true)

    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const u = await User.findOne({ where: { country_code: '+86', phone: '13911223344' } })
    expect(u).toBeTruthy()
  })

  it('OC-5 clear_cart=true → 下单后购物车被清空', async () => {
    await seedSystemConfigBaseline()
    const { user, token } = await userWithToken()
    const p = await activeProduct()
    await request(app).post('/api/cart').set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 1 })

    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], payment_method: 'cod', clear_cart: true })
    expect(res.status).toBe(201)

    const sequelize = TestDatabase.getSequelize()
    const { Cart } = sequelize.models
    const left = await Cart.count({ where: { user_id: user.id } })
    expect(left).toBe(0)
  })
})

describe('P1.portal.order.create — referral_code 边界', () => {
  beforeEach(async () => { await seedSystemConfigBaseline() })

  it('OC-6 referral_code="" → 视为未填，201', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], referral_code: '' })
    expect(res.status).toBe(201)
  })

  it('OC-7 referral_code=null → 视为未填，201', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], referral_code: null })
    expect(res.status).toBe(201)
  })

  it('OC-8 referral_code="ab"（短）→ 400', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], referral_code: 'ab' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('OC-9 referral_code 含中文 → 400', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], referral_code: '中文好长' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('OC-10 referral_code="abc12345" 合法 → 201', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], referral_code: 'abc12345' })
    expect(res.status).toBe(201)
  })
})

describe('P1.portal.order.create — 币种边界', () => {
  it('OC-11 CNY 配 0 → 400 未配置/未启用', async () => {
    await seedSystemConfigBaseline({ exchange_rates: { USD: '0.03', CNY: '0', MYR: '0.13' } })
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], checkout_currency: 'CNY' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/CNY/)
    expect(res.body.message).toMatch(/未配置|未启用/)
  })

  it('OC-12 USD 配 0.03 → 201', async () => {
    await seedSystemConfigBaseline()
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }], checkout_currency: 'USD' })
    expect(res.status).toBe(201)
    expect(res.body.data.order.currency_code).toBe('USD')
  })

  it('OC-13 checkout_currency 缺失 → 默认 THB → 201', async () => {
    await seedSystemConfigBaseline()
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }] })
    expect(res.status).toBe(201)
    expect(res.body.data.order.currency_code).toBe('THB')
  })
})

describe('P1.portal.order.create — 数据/参数边界', () => {
  beforeEach(async () => { await seedSystemConfigBaseline() })

  it('OC-14 product_id 不存在 → 400', async () => {
    const { token } = await userWithToken()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: 9999999, quantity: 1 }] })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/不存在/)
  })

  it('OC-15 库存=0 → 400 库存不足', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct({ stock: 0 })
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 1 }] })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/库存不足/)
  })

  it('OC-16 quantity 超 5000 → 400 VALIDATION_ERROR', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({ ...BODY, items: [{ product_id: p.id, quantity: 100000 }] })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('OC-17 缺 contact_phone → 400 VALIDATION_ERROR', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: 'X',
        delivery_address: 'A',
        items: [{ product_id: p.id, quantity: 1 }]
      })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })
})
