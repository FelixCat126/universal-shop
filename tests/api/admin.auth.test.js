/**
 * P3 Admin — 认证（5 用例）
 *   AA-1 happy 登录 → 200 + token
 *   AA-2 错密码 → 401
 *   AA-3 被禁用 → 401（admin login 仅放行 is_active=true）
 *   AA-4 缺用户名 → 400
 *   AA-5 GET /api/admin/validate-token → 200，缺 token → 401
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

const PWD = 'AdminPwd#1234'

describe('P3.admin.auth', () => {
  it('AA-1 happy 登录 → 200 + token', async () => {
    const admin = await TestHelpers.createAdminUser({ password: PWD, role: 'super_admin', is_active: true })
    const res = await request(app).post('/api/admin/login').send({
      username: admin.username, password: PWD
    })
    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.admin.id).toBe(admin.id)
  })

  it('AA-2 错密码 → 401', async () => {
    const admin = await TestHelpers.createAdminUser({ password: PWD })
    const res = await request(app).post('/api/admin/login').send({
      username: admin.username, password: 'wrong-#1'
    })
    expect(res.status).toBe(401)
  })

  it('AA-3 被禁用 → 401', async () => {
    const admin = await TestHelpers.createAdminUser({ password: PWD, is_active: false })
    const res = await request(app).post('/api/admin/login').send({
      username: admin.username, password: PWD
    })
    expect(res.status).toBe(401)
  })

  it('AA-4 缺用户名 → 400', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: PWD })
    expect(res.status).toBe(400)
  })

  it('AA-5 validate-token：有 token 200, 无 token 401', async () => {
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const token = TestHelpers.generateAdminToken(admin)
    const ok = await request(app)
      .get('/api/admin/validate-token').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)

    const no = await request(app).get('/api/admin/validate-token')
    expect(no.status).toBe(401)
  })
})
