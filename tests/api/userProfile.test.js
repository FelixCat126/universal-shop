/**
 * 用户注册 / 资料 / 密码 / 账号注销 的边界测试
 *
 * 这些接口之前只测了 happy path，**大量"拒绝坏输入"的分支没测** ——
 * 而那些分支恰恰是出问题代价最高的地方（越权改别人资料、弱密码被接受、
 * 注销了账号但数据还在……）。
 *
 *   UP-1 注册：必填字段缺失 → 400
 *   UP-2 注册：不支持的国家区号 → 400
 *   UP-3 注册：手机号格式非法 → 400
 *   UP-4 注册：手机号已存在 → 400
 *   UP-5 注册：正常 → 201
 *   UP-6 改资料：昵称超长 → 400
 *   UP-7 改资料：改别人的 → 404/403（越权）
 *   UP-8 改密码：旧密码错 → 400
 *   UP-9 改密码：弱密码 → 400
 *   UP-10 改密码：正确 → 成功，且旧密码失效新密码可用
 *   UP-11 注销账号：需要密码 → 密码错则拒绝
 *   UP-12 查手机号是否存在
 *   UP-13 验证推荐码：存在/不存在
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let token
let userId

const PASSWORD = 'UserPwd#2026'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { User } = TestDatabase.getSequelize().models
  const user = await User.create(await TestDataFactory.createUser({
    password: PASSWORD,
    country_code: '+66',
    phone: '812345678',
    email: 'profile@example.com',
    nickname: '资料测试用户'
  }))
  userId = user.id
  token = TestHelpers.generateToken(user)
})

const auth = (method, url) =>
  request(app)[method](url).set('Authorization', `Bearer ${token}`)

describe('用户注册', () => {
  it('UP-1 注册：必填字段缺失 → 400', async () => {
    for (const body of [
      { phone: '819999999', password: PASSWORD }, // 缺昵称
      { nickname: 'X', password: PASSWORD }, // 缺手机号
      { nickname: 'X', phone: '819999999' } // 缺密码
    ]) {
      const res = await request(app).post('/api/users/register').send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('UP-2 注册：不支持的国家区号 → 400', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'X', phone: '819999999', password: PASSWORD, country_code: '+81'
    })
    expect(res.status).toBe(400)
  })

  it('UP-3 注册：手机号格式非法 → 400', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'X', phone: '123', password: PASSWORD, country_code: '+66'
    })
    expect(res.status).toBe(400)
  })

  it('UP-4 注册：手机号已存在 → 400', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: 'X', phone: '812345678', password: PASSWORD, country_code: '+66'
    })
    expect(res.status).toBe(400)
  })

  it('UP-5 注册：正常 → 201', async () => {
    const res = await request(app).post('/api/users/register').send({
      nickname: '新用户', phone: '819876543', password: PASSWORD, country_code: '+66'
    })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
  })
})

describe('用户资料', () => {
  it('UP-6 改资料：昵称超长 → 400', async () => {
    const res = await auth('put', '/api/users/profile').send({ nickname: 'x'.repeat(300) })
    expect(res.status).toBe(400)
  })

  it('UP-7 改资料：不能改到别人身上（越权）', async () => {
    const { User } = TestDatabase.getSequelize().models
    const other = await User.create(await TestDataFactory.createUser({
      password: PASSWORD, country_code: '+66', phone: '811111111'
    }))
    const otherBefore = other.nickname

    // 显式传 user_id 试图改别人的资料
    const res = await auth('put', '/api/users/profile').send({
      nickname: '被篡改', user_id: other.id
    })
    if (res.status === 200) {
      // 接口按 token 定位当前用户（这是对的）→ 改的是自己，**别人不能被改**
      const otherFresh = await User.findByPk(other.id)
      expect(otherFresh.nickname, '越权改到了别人的资料').toBe(otherBefore)
      const fresh = await User.findByPk(userId)
      expect(fresh.nickname).toBe('被篡改')
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400)
      const otherFresh = await User.findByPk(other.id)
      expect(otherFresh.nickname).toBe(otherBefore)
    }
  })
})

describe('用户密码', () => {
  it('UP-8 改密码：旧密码错 → 400', async () => {
    const res = await auth('put', '/api/users/profile/password').send({
      oldPassword: 'WrongPwd#2026', newPassword: 'NewPwd#2026'
    })
    expect(res.status).toBe(400)
  })

  it('UP-9 改密码：弱密码 → 400', async () => {
    const res = await auth('put', '/api/users/profile/password').send({
      oldPassword: PASSWORD, newPassword: '123'
    })
    expect(res.status).toBe(400)
  })

  it('UP-10 改密码：正确 → 旧密码失效、新密码可用', async () => {
    const res = await auth('put', '/api/users/profile/password').send({
      old_password: PASSWORD, new_password: 'BrandNew#2026'
    })
    expect(res.status).toBe(200)

    // 登录时 phone 必须配 country_code（loginSchema 的 .with('phone','country_code')）
    const login = await request(app).post('/api/users/login').send({
      country_code: '+66', phone: '812345678', password: 'BrandNew#2026'
    })
    expect(login.status).toBe(200)

    // 旧密码应失效
    const oldLogin = await request(app).post('/api/users/login').send({
      country_code: '+66', phone: '812345678', password: PASSWORD
    })
    expect(oldLogin.status).toBe(401)
  })
})

describe('账号注销与查询', () => {
  it('UP-11 注销账号：密码错则拒绝（数据不能被误删）', async () => {
    const res = await auth('post', '/api/users/me/delete').send({ password: 'WrongPwd#2026' })
    expect(res.status).toBeGreaterThanOrEqual(400)

    const { User } = TestDatabase.getSequelize().models
    expect(await User.findByPk(userId)).toBeTruthy()
  })

  it('UP-12 查手机号是否存在', async () => {
    const res = await request(app).get('/api/users/check-phone/812345678')
    expect(res.status).toBe(200)
    expect(res.body.data?.exists ?? res.body.data).toBeTruthy()
  })

  it('UP-13 验证推荐码：存在 / 不存在', async () => {
    const { User } = TestDatabase.getSequelize().models
    const user = await User.findByPk(userId)
    const code = user.referral_code

    const ok = await request(app).get(`/api/users/verify-referral/${code}`)
    expect(ok.status).toBe(200)
    expect(ok.body.success).toBe(true)

    const missing = await request(app).get('/api/users/verify-referral/NOSUCHCODE')
    expect(missing.status).toBe(404)
  })
})
