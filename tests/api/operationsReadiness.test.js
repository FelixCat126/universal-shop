/**
 * 运维就绪：指标、注销匿名化、审计保留（5 用例）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { cleanupRetentionData } from '@server/services/retentionService.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

const models = () => TestDatabase.getSequelize().models

async function makeUser (overrides = {}) {
  const { User } = models()
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
}

describe('Operations.readiness', () => {
  it('OPS-1 /admin/metrics 仅超管可访问，并返回 X-Request-ID', async () => {
    const superAdmin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const superToken = TestHelpers.generateAdminToken(superAdmin)
    const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${superToken}`)
    expect(res.status).toBe(200)
    expect(res.headers['x-request-id']).toBeTruthy()
    expect(res.body.data).toHaveProperty('requests')
    expect(typeof res.body.data.uptimeSeconds).toBe('number')

    const operator = await TestHelpers.createAdminUser({ role: 'operator' })
    const operatorToken = TestHelpers.generateAdminToken(operator)
    const denied = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${operatorToken}`)
    expect(denied.status).toBe(403)
  })

  it('OPS-2 注销账号匿名化并禁用，旧 token 失效，订单保留', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const { Order } = models()
    await Order.create({
      order_no: `T${Date.now()}`,
      user_id: user.id,
      total_amount: 100,
      total_amount_thb: 100,
      contact_name: 'X',
      contact_phone: user.phone,
      delivery_address: 'A',
      status: 'shipping',
      payment_method: 'cod'
    })

    const res = await request(app).post('/api/users/me/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Abcd1234' })
    expect(res.status).toBe(200)

    const { User } = models()
    const fresh = await User.findByPk(user.id)
    expect(fresh.is_active).toBe(false)
    expect(fresh.nickname).toBe('已注销用户')
    expect(fresh.email).toBeNull()
    expect(fresh.username).toBe(`deleted_${user.id}`)

    const after = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`)
    expect([401, 403]).toContain(after.status)
    expect(await Order.count({ where: { user_id: user.id } })).toBe(1)
  })

  it('OPS-3 注销时密码错误返回 400，不修改账号', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).post('/api/users/me/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrongpass' })
    expect(res.status).toBe(400)
    const { User } = models()
    expect((await User.findByPk(user.id)).is_active).toBe(true)
  })

  it('OPS-4 审计保留清理：删除超期记录，保留近期记录', async () => {
    const { AuditLog, OperationLog } = models()
    const oldDate = new Date(Date.now() - 800 * 86400000)
    await AuditLog.create(TestDataFactory.createAuditLog({ event: 'old', created_at: oldDate }))
    await AuditLog.create(TestDataFactory.createAuditLog({ event: 'recent' }))
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    await OperationLog.create(TestDataFactory.createOperationLog(admin.id, admin.username, {
      action: 'old',
      created_at: oldDate
    }))
    await OperationLog.create(TestDataFactory.createOperationLog(admin.id, admin.username, {
      action: 'recent'
    }))

    const result = await cleanupRetentionData({ auditDays: 365, operationDays: 730 })
    expect(result.auditDeleted).toBe(1)
    expect(result.operationDeleted).toBe(1)
    expect(await AuditLog.count({ where: { event: 'old' } })).toBe(0)
    expect(await AuditLog.count({ where: { event: 'recent' } })).toBe(1)
    expect(await OperationLog.count({ where: { action: 'old' } })).toBe(0)
    expect(await OperationLog.count({ where: { action: 'recent' } })).toBe(1)
  })

  it('OPS-5 无审计记录时清理返回 0', async () => {
    const result = await cleanupRetentionData()
    expect(result.auditDeleted).toBe(0)
    expect(result.operationDeleted).toBe(0)
  })
})
