/**
 * P1 用户面 — 注册主流程 + 边界（8 用例）
 *   R-1 happy 注册成功（+86 / +66 / +60 三种区号）
 *   R-2 必填缺失：缺密码 → 400 VALIDATION_ERROR
 *   R-3 必填缺失：缺手机号 → 400 VALIDATION_ERROR
 *   R-4 弱密码（< 8 位 / 无字母 / 无数字）→ 400（密码策略 by controller）
 *   R-5 重复手机号 → 400
 *   R-6 重复邮箱 → 400
 *   R-7 不支持的 country_code（+1 美国） → 400 VALIDATION_ERROR
 *   R-8 被禁用账户的手机号注册 → 403（特殊提示）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

const PWD = 'StrongPass#1234'

describe('P1.user.register', () => {
  it('R-1.1 +86 手机号注册成功 → 201 + token', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'A',
      country_code: '+86',
      phone: '13900000001',
      password: PWD
    })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.user.phone).toBe('13900000001')
    expect(res.body.data.user.country_code).toBe('+86')
  })

  it('R-1.2 +66 手机号注册成功', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'TH',
      country_code: '+66',
      phone: '900000001',
      password: PWD
    })
    expect(res.status).toBe(201)
    expect(res.body.data.user.country_code).toBe('+66')
  })

  it('R-1.3 默认区号 +66（未传 country_code）', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'Default',
      phone: '900000002',
      password: PWD
    })
    expect(res.status).toBe(201)
    expect(res.body.data.user.country_code).toBe('+66')
  })

  it('R-2 缺密码 → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'A',
      country_code: '+86',
      phone: '13900000010'
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('R-3 缺手机号 → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'A',
      country_code: '+86',
      password: PWD
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('R-4 弱密码（无字母）→ 400', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'A',
      country_code: '+86',
      phone: '13900000020',
      password: '12345678' // 8 位但纯数字
    })
    expect(res.status).toBe(400)
  })

  it('R-5 重复手机号 → 400', async () => {
    const phone = '13900000030'
    await request(app).post('/api/users/register').send({
      nickname: 'A1', country_code: '+86', phone, password: PWD
    })
    const r2 = await request(app).post('/api/users/register').send({
      nickname: 'A2', country_code: '+86', phone, password: PWD
    })
    expect(r2.status).toBe(400)
    expect(r2.body.message).toMatch(/手机号已被注册/)
  })

  it('R-6 重复邮箱 → 400', async () => {
    const email = `dup${Date.now()}@x.com`
    await request(app).post('/api/users/register').send({
      nickname: 'E1', country_code: '+86', phone: '13900000040', email, password: PWD
    })
    const r2 = await request(app).post('/api/users/register').send({
      nickname: 'E2', country_code: '+86', phone: '13900000041', email, password: PWD
    })
    expect(r2.status).toBe(400)
    expect(r2.body.message).toMatch(/邮箱已被注册/)
  })

  it('R-7 不支持的 country_code +1 → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'A',
      country_code: '+1',
      phone: '5551234567',
      password: PWD
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('R-8 被禁用账户的手机号注册 → 403', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const userData = await TestDataFactory.createUser({
      country_code: '+86',
      phone: '13900000050',
      is_active: false
    })
    await User.create(userData)

    const res = await request(app).post('/api/users/register').send({
      nickname: 'A',
      country_code: '+86',
      phone: '13900000050',
      password: PWD
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/已被禁用/)
  })
})
