/**
 * P2 合作方 — 认证（4 用例）
 *   PA-1 happy 登录 → 200 + token + partner
 *   PA-2 错密码 → 401
 *   PA-3 被禁用 → 401
 *   PA-4 缺登录名/密码 → 400
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

const PWD = 'Abcd1234'

async function makePartner (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Partner } = sequelize.models
  return Partner.create(TestDataFactory.createPartner({ password: PWD, ...overrides }))
}

describe('P2.partner.auth', () => {
  it('PA-1 happy 登录 → 200 + token', async () => {
    const p = await makePartner()
    const res = await request(app).post('/api/partner/login').send({
      login: p.login, password: PWD
    })
    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.partner.id).toBe(p.id)
  })

  it('PA-2 错密码 → 401', async () => {
    const p = await makePartner()
    const res = await request(app).post('/api/partner/login').send({
      login: p.login, password: 'wrong-pass-#1'
    })
    expect(res.status).toBe(401)
  })

  it('PA-3 被禁用 → 401', async () => {
    const p = await makePartner({ is_active: false })
    const res = await request(app).post('/api/partner/login').send({
      login: p.login, password: PWD
    })
    expect(res.status).toBe(401)
  })

  it('PA-4 缺登录名 → 400', async () => {
    const res = await request(app).post('/api/partner/login').send({ password: PWD })
    expect(res.status).toBe(400)
  })
})
