/**
 * P3 Admin — 用户（5 用例）
 *   AU-1 GET /api/admin/users 列表 happy → 200 + 分页
 *   AU-2 PUT /api/admin/users/:id/status 禁用 → 200
 *   AU-3 PUT /api/admin/users/:id/status is_active 非 boolean → 400
 *   AU-4 GET /api/admin/users/:userId/addresses → 200 + 数组
 *   AU-5 GET /api/export/users xlsx → 200
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

async function makeUser (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    ...overrides
  }))
}

describe('P3.admin.user', () => {
  it('AU-1 GET 列表 happy', async () => {
    const { token } = await adminCtx()
    await makeUser()
    await makeUser()
    const res = await request(app).get('/api/admin/users?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.users.length).toBeGreaterThanOrEqual(2)
  })

  it('AU-2 PUT /:id/status 禁用 → 200', async () => {
    const { token } = await adminCtx()
    const u = await makeUser({ is_active: true })
    const res = await request(app).put(`/api/admin/users/${u.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: false })
    expect(res.status).toBe(200)
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const fresh = await User.findByPk(u.id)
    expect(fresh.is_active).toBe(false)
  })

  it('AU-3 PUT /:id/status is_active 非 boolean → 400', async () => {
    const { token } = await adminCtx()
    const u = await makeUser()
    const res = await request(app).put(`/api/admin/users/${u.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: 'no' })
    expect(res.status).toBe(400)
  })

  it('AU-4 GET /:userId/addresses → 200 + 数组', async () => {
    const { token } = await adminCtx()
    const u = await makeUser()
    const sequelize = TestDatabase.getSequelize()
    const { Address } = sequelize.models
    await Address.create(TestDataFactory.createAddress(u.id))

    const res = await request(app).get(`/api/admin/users/${u.id}/addresses`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(1)
  })

  it('AU-5 GET /api/export/users xlsx → 200', async () => {
    const { token } = await adminCtx()
    await makeUser()
    const res = await request(app).get('/api/admin/export/users')
      .set('Authorization', `Bearer ${token}`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
  })
})
