/**
 * Token Version / 密钥分桶（6 用例）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'
import { _clearAdminAuthCacheForTests } from '@server/middlewares/adminAuthMiddleware.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
  _clearAdminAuthCacheForTests()
})

async function makeUser (overrides = {}) {
  const { User } = TestDatabase.getSequelize().models
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
}

describe('Security.tokenVersion', () => {
  it('TV-1 用户改密后旧 token 立即失效', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const ok = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)

    const changed = await request(app).put('/api/users/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'Abcd1234', new_password: 'Newpass1234' })
    expect(changed.status).toBe(200)

    const after = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`)
    expect(after.status).toBe(401)
  })

  it('TV-2 用户登出后旧 token 立即失效', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const out = await request(app).post('/api/users/logout').set('Authorization', `Bearer ${token}`)
    expect(out.status).toBe(200)
    const after = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`)
    expect(after.status).toBe(401)
  })

  it('TV-3 Admin 重置密码后旧 token 立即失效', async () => {
    const target = await TestHelpers.createAdminUser({ role: 'admin' })
    const superAdmin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const oldToken = TestHelpers.generateAdminToken(target)
    const superToken = TestHelpers.generateAdminToken(superAdmin)

    const ok = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${oldToken}`)
    expect(ok.status).toBe(200)

    const reset = await request(app).put(`/api/admin/administrators/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ password: 'Reset1234' })
    expect(reset.status).toBe(200)

    const after = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${oldToken}`)
    expect(after.status).toBe(401)
  })

  it('TV-4 Partner 重置密码后旧 token 立即失效', async () => {
    const partner = await TestHelpers.createPartnerWithAddress({})
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)

    const reset = await request(app).put(`/api/admin/partners/${partner.partner.id}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'Reset1234' })
    expect(reset.status).toBe(200)

    const after = await request(app).get('/api/partner/me').set('Authorization', `Bearer ${partner.token}`)
    expect(after.status).toBe(401)
  })

  it('TV-5 三套密钥隔离：Admin token 不能访问 Partner，Partner token 不能访问 Admin', async () => {
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)
    const partner = await TestHelpers.createPartnerWithAddress({})
    const partnerToken = partner.token

    const p = await request(app).get('/api/partner/me').set('Authorization', `Bearer ${adminToken}`)
    expect([401, 403]).toContain(p.status)
    const a = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${partnerToken}`)
    expect([401, 403]).toContain(a.status)
  })

  it('TV-6 伪造 user token（用 Admin secret 签名）不能访问用户接口', async () => {
    const user = await makeUser()
    const forged = jwt.sign(
      { userId: user.id, username: user.username, type: 'user', tv: 0 },
      process.env.JWT_ADMIN_SECRET,
      { expiresIn: '1h' }
    )
    const res = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${forged}`)
    expect([401, 403]).toContain(res.status)
  })
})
