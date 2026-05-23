/**
 * P1 用户面 — 订单查询（3 用例）
 *   OQ-1 GET /api/orders 列表分页 happy → 200 + 数据
 *   OQ-2 GET /api/orders/:id 详情 happy → 200
 *   OQ-3 GET /api/orders/:id 跨用户 → 404
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

async function userWithToken () {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const u = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    })
  )
  return { user: u, token: TestHelpers.generateToken(u) }
}

async function plainOrder (user, overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Order } = sequelize.models
  return Order.create({
    order_no: `OQ${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    status: 'shipping',
    contact_name: 'X',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1,
    ...overrides
  })
}

describe('P1.portal.order.query', () => {
  it('OQ-1 GET /api/orders 列表分页 happy', async () => {
    const { user, token } = await userWithToken()
    await plainOrder(user)
    await plainOrder(user)

    const res = await request(app)
      .get('/api/orders?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.orders.length).toBe(2)
    expect(res.body.data.total).toBe(2)
    expect(res.body.data.page).toBe(1)
  })

  it('OQ-2 GET /api/orders/:id 详情 happy', async () => {
    const { user, token } = await userWithToken()
    const o = await plainOrder(user)

    const res = await request(app)
      .get(`/api/orders/${o.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(o.id)
  })

  it('OQ-3 GET /api/orders/:id 跨用户 → 404', async () => {
    const { user: owner } = await userWithToken()
    const { token: other } = await userWithToken()
    const o = await plainOrder(owner)

    const res = await request(app)
      .get(`/api/orders/${o.id}`)
      .set('Authorization', `Bearer ${other}`)
    expect(res.status).toBe(404)
  })
})
