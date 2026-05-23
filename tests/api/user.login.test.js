/**
 * P1 用户面 — 登录主流程 + 边界（7 用例）
 *   L-1 手机号 + 密码登录 → 200 + token
 *   L-2 邮箱 + 密码登录（兼容） → 200 + token
 *   L-3 错密码 → 401
 *   L-4 用户不存在 → 401
 *   L-5 被禁用账户 → 403
 *   L-6 既无 phone 也无 email → 400 VALIDATION_ERROR
 *   L-7 phone 不带 country_code → 400 VALIDATION_ERROR（with('phone','country_code') 约束）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

const PWD = 'StrongPass#1234'

async function createActiveUser (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const data = await TestDataFactory.createUser({
    country_code: '+86',
    phone: '13900000100',
    email: `u${Date.now()}@x.com`,
    password: PWD,
    is_active: true,
    ...overrides
  })
  return User.create(data)
}

describe('P1.user.login', () => {
  it('L-1 手机号 + 密码登录 → 200 + token', async () => {
    const u = await createActiveUser({ phone: '13900000101' })
    const res = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone: u.phone,
      password: PWD
    })
    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.user.id).toBe(u.id)
  })

  it('L-2 邮箱 + 密码登录（兼容）→ 200 + token', async () => {
    const u = await createActiveUser({ phone: '13900000102', email: 'login.email@x.com' })
    const res = await request(app).post('/api/users/login').send({
      email: u.email,
      password: PWD
    })
    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe('login.email@x.com')
  })

  it('L-3 错密码 → 401', async () => {
    const u = await createActiveUser({ phone: '13900000103' })
    const res = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone: u.phone,
      password: 'wrong-password-#1'
    })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/用户名或密码错误/)
  })

  it('L-4 用户不存在 → 401', async () => {
    const res = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone: '13900099999',
      password: PWD
    })
    expect(res.status).toBe(401)
  })

  it('L-5 被禁用账户 → 403', async () => {
    const u = await createActiveUser({ phone: '13900000105', is_active: false })
    const res = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone: u.phone,
      password: PWD
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/账户已被禁用/)
  })

  it('L-6 既无 phone 也无 email → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/users/login').send({
      password: PWD
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('L-7 phone 不带 country_code → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/users/login').send({
      phone: '13900000107',
      password: PWD
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })
})
