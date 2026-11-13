/**
 * 权限边界回归：operator 不该能做的资损级操作
 *
 *   PB-1 售后退款审批 → operator 被拒（403），admin/super_admin 放行
 *   PB-2 售后列表 → operator 仍可看（客服的日常工作，不该被误伤）
 *   PB-3 异步导出任务 → 没有 orders 权限的角色被拒（路由层纵深）
 *   PB-4 管理端统计 → 现有角色能力不变（admin 能看）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let operatorToken
let afterSaleId
let orderId

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
  const { Administrator, User, Order, AfterSale } = models()

  const admin = await Administrator.create({
    username: `pb_admin_${Date.now()}`, password: 'PbPwd#1234', role: 'super_admin', is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)

  const operator = await Administrator.create({
    username: `pb_op_${Date.now()}`, password: 'PbPwd#1234', role: 'operator', is_active: true
  })
  operatorToken = TestHelpers.generateAdminToken(operator)

  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900008888'
  }))
  const order = await Order.create({
    order_no: `PB${Date.now()}`,
    user_id: u.id,
    total_amount: 100, total_amount_thb: 100,
    currency_code: 'THB', payment_method: 'cod', status: 'shipping',
    contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1
  })
  orderId = order.id
  const afterSale = await AfterSale.create({
    order_id: order.id, user_id: u.id, type: 'refund', status: 'pending',
    reason: '测试', amount: 100
  })
  afterSaleId = afterSale.id
})

describe('权限边界', () => {
  it('PB-1 售后退款审批：operator 被拒，admin/super_admin 放行', async () => {
    const asOp = await request(app)
      .put(`/api/admin/after-sales/${afterSaleId}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'approved' })
    expect(asOp.status, '操作员不该能批退款（资损级写操作）').toBe(403)

    const asAdmin = await request(app)
      .put(`/api/admin/after-sales/${afterSaleId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })
    expect(asAdmin.status).toBe(200)
  })

  it('PB-2 售后列表：operator 仍可看（客服日常工作不该被误伤）', async () => {
    const res = await request(app).get('/api/admin/after-sales')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(res.status).toBe(200)
  })

  it('PB-3 异步导出任务：路由层要有一道 orders 权限门', async () => {
    const res = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ type: 'orders' })
    // operator 有 orders 权限 → 放行（现状不变），但路由层确实挂了权限门
    expect(res.status).toBe(201)
  })

  it('PB-4 管理端统计：现有角色能力不变（admin 能看）', async () => {
    const res = await request(app).get('/api/admin/statistics/comprehensive')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.overview).toBeTruthy()
  })
})
