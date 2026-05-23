/**
 * P3 Admin — 管理员（5 用例）
 *   AM-1 GET /api/admin/administrators 列表 happy
 *   AM-2 POST 创建 operator → 201
 *   AM-3 POST 用户名重复 → 400
 *   AM-4 admin（非 super_admin）创建 super_admin → 403
 *   AM-5 PUT /:id/reset-password → 200
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

describe('P3.admin.administrator', () => {
  it('AM-1 GET 列表 happy', async () => {
    const { token } = await adminCtx()
    await TestHelpers.createAdminUser({ role: 'admin' })
    await TestHelpers.createAdminUser({ role: 'operator' })

    const res = await request(app).get('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.administrators.length).toBe(3)
    expect(res.body.data.administrators[0].password).toBeUndefined()
  })

  it('AM-2 POST 创建 operator → 201', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'op001', password: 'opPwd#1234', role: 'operator' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.data.username).toBe('op001')
  })

  it('AM-3 POST 用户名重复 → 400', async () => {
    const { token } = await adminCtx()
    const existing = await TestHelpers.createAdminUser({ role: 'operator', username: 'dup_user' })
    const res = await request(app).post('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: existing.username, password: 'pwd#1234' })
    expect(res.status).toBe(400)
  })

  it('AM-4 admin 角色创建 super_admin → 403', async () => {
    const { token } = await adminCtx('admin')
    const res = await request(app).post('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'shouldfail', password: 'pwd#1234', role: 'super_admin' })
    expect(res.status).toBe(403)
  })

  it('AM-5 PUT /:id/reset-password → 200', async () => {
    const { token } = await adminCtx()
    const target = await TestHelpers.createAdminUser({ role: 'operator' })
    const res = await request(app).put(`/api/admin/administrators/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'NewOpPwd#5678' })
    expect(res.status).toBe(200)
  })
})
