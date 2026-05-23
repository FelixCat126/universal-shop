/**
 * P1 用户面 — 个人资料 + 改密（5 用例）
 *   P-1 GET /profile happy → 200
 *   P-2 GET /profile 未登录 → 401
 *   P-3 PUT /profile 改昵称 → 200
 *   P-4 PUT /profile/password 改密码 happy → 200，可用新密码登录
 *   P-5 PUT /profile/password 旧密码错 → 400
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

const PWD = 'StrongPass#1234'

async function activeUserWithToken (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const data = await TestDataFactory.createUser({
    country_code: '+86',
    phone: '13900000200',
    email: `prof${Date.now()}@x.com`,
    password: PWD,
    ...overrides
  })
  const user = await User.create(data)
  const token = TestHelpers.generateToken(user)
  return { user, token }
}

describe('P1.user.profile', () => {
  it('P-1 GET /profile happy → 200', async () => {
    const { user, token } = await activeUserWithToken()
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(user.id)
    expect(res.body.data.password).toBeUndefined()
  })

  it('P-2 GET /profile 未登录 → 401', async () => {
    const res = await request(app).get('/api/users/profile')
    expect(res.status).toBe(401)
  })

  it('P-3 PUT /profile 改昵称 → 200', async () => {
    const { token } = await activeUserWithToken({ phone: '13900000201' })
    const res = await request(app)
      .put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'NewNick' })
    expect(res.status).toBe(200)
    expect(res.body.data.nickname).toBe('NewNick')
  })

  it('P-4 PUT /profile/password 改密码 happy → 200，可用新密码登录', async () => {
    const newPwd = 'AnotherPwd#5678'
    const { user, token } = await activeUserWithToken({ phone: '13900000202' })

    const r1 = await request(app)
      .put('/api/users/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ old_password: PWD, new_password: newPwd })
    expect(r1.status).toBe(200)

    // 旧密码不应再可登录
    const rOld = await request(app).post('/api/users/login').send({
      country_code: '+86', phone: user.phone, password: PWD
    })
    expect(rOld.status).toBe(401)

    // 新密码应可登录
    const rNew = await request(app).post('/api/users/login').send({
      country_code: '+86', phone: user.phone, password: newPwd
    })
    expect(rNew.status).toBe(200)
  })

  it('P-5 PUT /profile/password 旧密码错 → 400', async () => {
    const { token } = await activeUserWithToken({ phone: '13900000203' })
    const res = await request(app)
      .put('/api/users/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'wrong-old', new_password: 'AnotherPwd#5678' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/当前密码不正确/)
  })
})
