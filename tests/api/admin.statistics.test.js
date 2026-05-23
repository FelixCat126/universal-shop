/**
 * P3 Admin — 统计（4 用例）
 *   ST-1 GET /api/statistics/overview happy → 200 + 字段
 *   ST-2 GET /api/statistics/order-trend → 200 + 7 天数组
 *   ST-3 GET /api/statistics/user-trend → 200 + 7 天数组
 *   ST-4 GET /api/statistics/comprehensive → 200
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return { token: TestHelpers.generateAdminToken(admin) }
}

describe('P3.admin.statistics', () => {
  it('ST-1 overview happy', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { User, Order } = sequelize.models
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13912345001'
    }))
    await Order.create({
      order_no: `ST${Date.now()}`,
      user_id: u.id, total_amount: 100, total_amount_thb: 100,
      currency_code: 'THB', payment_method: 'cod', status: 'completed',
      contact_name: 'X', contact_phone: '1', delivery_address: 'A', exchange_rate: 1
    })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.totalOrders).toBe(1)
    expect(parseFloat(res.body.data.totalAmount)).toBe(100)
    expect(res.body.data.totalUsers).toBeGreaterThanOrEqual(1)
  })

  it('ST-2 order-trend → 200 + 7 天数组', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/statistics/order-trend')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBe(7)
  })

  it('ST-3 user-trend → 200 + 7 天数组', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/statistics/user-trend')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBe(7)
  })

  it('ST-4 comprehensive → 200', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/statistics/comprehensive')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
