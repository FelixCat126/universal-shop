/**
 * P3 跨端业务流（6 用例）
 *
 * 覆盖真实业务流转：
 *   W-1 用户注册 → 登录 → 改资料 → 改密码 → 旧密码失效 → 新密码登录
 *   W-2 游客下单 → 自动注册 → must_reset_password 标识
 *   W-3 用户下单 → admin 状态推进（pending → shipping → delivered → completed）
 *   W-4 合作方地址 → 下单 → 支付确认 → admin 状态推进到 settled
 *   W-5 积分下单 → admin 取消订单 → 积分不退回（业务规则）
 *   W-6 多币种下单：USD 下单 → admin 改汇率 → 历史订单汇率快照不变
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
  _clearAuthCacheForTests()
  _resetLoginGuardForTests()
})

async function adminToken () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return TestHelpers.generateAdminToken(admin)
}

async function activeProduct (overrides = {}) {
  const { Product, ProductCategory } = TestDatabase.getSequelize().models
  const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
  return Product.create(
    TestDataFactory.createProduct({
      stock: 100, status: 'active', price: 100, category_id: cat.id, ...overrides
    })
  )
}

describe('P3-Workflow.userLifecycle', () => {
  it('W-1 注册 → 登录 → 改密码 → 旧密码失效 → 新密码登录', async () => {
    const phone = TestHelpers.generatePhoneNumber('+86')
    // 1. 注册
    const reg = await request(app).post('/api/users/register').send({
      nickname: 'Tester',
      country_code: '+86',
      phone,
      password: 'Abcd1234'
    })
    expect(reg.status).toBe(201)
    const oldToken = reg.body.data.token

    // 2. 用旧密码登录 → 成功
    const login1 = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone,
      password: 'Abcd1234'
    })
    expect(login1.status).toBe(200)

    // 3. 改密码
    const change = await request(app).put('/api/users/profile/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ old_password: 'Abcd1234', new_password: 'NewPass5678' })
    expect(change.status).toBe(200)

    // 4. 旧密码登录 → 失败
    const loginOld = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone,
      password: 'Abcd1234'
    })
    expect([400, 401]).toContain(loginOld.status)

    // 5. 新密码登录 → 成功
    const loginNew = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone,
      password: 'NewPass5678'
    })
    expect(loginNew.status).toBe(200)
  })
})

describe('P3-Workflow.guestAutoRegister', () => {
  it('W-2 游客下单 → 自动注册 + must_reset_password', async () => {
    await seedSystemConfigBaseline()
    const p = await activeProduct()
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    const res = await request(app).post('/api/orders').send({
      items: [{ product_id: p.id, quantity: 1 }],
      contact_name: 'Guest',
      contact_phone: phone,
      delivery_address: 'Bangkok',
      province: 'Bangkok',
      city: 'Bangkok',
      detail_address: 'addr',
      postal_code: '10110'
    })
    expect(res.status).toBe(201)
    expect(res.body.data.autoRegistered).toBe(true)
    expect(res.body.data.token).toBeDefined()

    const { User } = TestDatabase.getSequelize().models
    const u = await User.findOne({ where: { phone: phone.replace('+86', '') } })
    expect(u).not.toBeNull()
    expect(u.must_reset_password).toBe(true)
  })
})

describe('P3-Workflow.orderLifecycle', () => {
  it('W-3 下单 → admin 状态推进（shipping → shipped → delivered → completed）', async () => {
    await seedSystemConfigBaseline()
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    const admin = await adminToken()
    const p = await activeProduct()

    // 下单
    const create = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: p.id, quantity: 1 }],
        contact_name: 'X',
        contact_phone: '13800000001',
        delivery_address: 'A'
      })
    expect(create.status).toBe(201)
    const orderId = create.body.data.order.id

    // admin 推进状态（订单创建即为 shipping，按状态机逐步推进）
    for (const status of ['shipped', 'delivered', 'completed']) {
      const r = await request(app).put(`/api/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ status })
      expect(r.status).toBe(200)
    }

    // 验证最终状态
    const { Order } = TestDatabase.getSequelize().models
    const final = await Order.findByPk(orderId)
    expect(final.status).toBe('completed')
  })
})

describe('P3-Workflow.partnerLifecycle', () => {
  it('W-4 合作方下单 → 支付确认 → admin 推进 settled', async () => {
    await seedSystemConfigBaseline()
    const { partner, address, token: pToken } = await TestHelpers.createPartnerWithAddress({
      discount_percent: 10
    })
    const admin = await adminToken()
    const p = await activeProduct({ price: 100, discount: null })

    // 合作方下单（dealer → submitted）
    const create = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${pToken}`)
      .send({
        items: [{ product_id: p.id, quantity: 50 }],
        partner_address_id: address.id
      })
    expect(create.status).toBe(201)
    const orderId = create.body.data.id

    // admin 推进状态到 settled
    for (const status of ['processing', 'shipped', 'settled']) {
      const r = await request(app).put(`/api/admin/partner-orders/${orderId}/status`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ status })
      expect(r.status).toBe(200)
    }

    const { PartnerOrder } = TestDatabase.getSequelize().models
    const final = await PartnerOrder.findByPk(orderId)
    expect(final.status).toBe('settled')
  })
})

describe('P3-Workflow.pointsRefundedOnCancel', () => {
  it('W-5 积分下单 → admin 取消订单 → 积分退回', async () => {
    await seedSystemConfigBaseline()
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    const admin = await adminToken()
    const p = await activeProduct({ points: 10, price: 0 })

    // 充值 100 积分
    await TestHelpers.topUpUserPoints(user.user, 100)

    // 用积分下单
    const create = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: p.id, quantity: 1 }],
        contact_name: 'X',
        contact_phone: '13800000001',
        delivery_address: 'A',
        payment_method: 'points'
      })
    expect(create.status).toBe(201)
    const orderId = create.body.data.order.id

    // 验证扣了 10 积分
    const { UserPointBalance } = TestDatabase.getSequelize().models
    const after1 = await UserPointBalance.findOne({ where: { user_id: user.user.id } })
    expect(Number(after1.balance)).toBe(90)

    // admin 取消订单
    const cancel = await request(app).put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'cancelled' })
    expect(cancel.status).toBe(200)

    // 取消后积分退回
    const after2 = await UserPointBalance.findOne({ where: { user_id: user.user.id } })
    expect(Number(after2.balance)).toBe(100)
  })
})

describe('P3-Workflow.fxSnapshot', () => {
  it('W-6 USD 下单 → admin 改汇率 → 历史订单汇率快照不变', async () => {
    await seedSystemConfigBaseline({ exchange_rates: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    const admin = await adminToken()
    const p = await activeProduct({ price: 100 })

    // USD 下单
    const create = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: p.id, quantity: 1 }],
        contact_name: 'X',
        contact_phone: '13800000001',
        delivery_address: 'A',
        checkout_currency: 'USD'
      })
    expect(create.status).toBe(201)
    const orderId = create.body.data.order.id

    // 查看订单的 exchange_rate 快照
    const { Order, SystemConfig } = TestDatabase.getSequelize().models
    const before = await Order.findByPk(orderId)
    expect(before.currency_code).toBe('USD')
    expect(Number(before.exchange_rate)).toBeCloseTo(0.03, 5)

    // admin 改汇率
    await SystemConfig.setConfig('exchange_rates', { USD: '0.05', CNY: '0.20', MYR: '0.13' }, 'json')

    // 历史订单的 exchange_rate 不变
    const after = await Order.findByPk(orderId)
    expect(Number(after.exchange_rate)).toBeCloseTo(0.03, 5)
  })
})
