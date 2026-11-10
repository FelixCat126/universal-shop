/**
 * 管理端辅助重置客户密码 测试
 *
 * 这条路径是**客户忘记密码时唯一的找回方式**：
 * 自助重置依赖短信通道（线上没配 → 永远回不来）。
 *
 *   UR-1 重置 → 生成临时密码 + 标记必须改密 + 旧会话失效
 *   UR-2 临时密码能登录，登录响应带 must_reset_password
 *   UR-3 用户不存在 → 404
 *   UR-4 用户已禁用 → 400
 *   UR-5 无效 id → 400
 *   UR-6 未登录 → 401
 *   UR-7 无 users 权限的角色 → 403
 *   UR-8 改完密码后 → 临时密码失效，标记清掉
 *   UR-9 临时密码的格式：12 位，含大小写/数字/特殊字符，不含易混字符
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let adminToken
let user

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `ur_admin_${Date.now()}`,
    password: 'UrPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)

  const { User } = TestDatabase.getSequelize().models
  user = await User.create(await TestDataFactory.createUser({
    nickname: '找回密码用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: `ur${Date.now()}@example.com`,
    password: 'OriginalPwd#2026'
  }))
})

const reset = (id = user.id) =>
  request(app).put(`/api/admin/users/${id}/password`).set('Authorization', `Bearer ${adminToken}`)

describe('管理端辅助重置客户密码', () => {
  it('UR-1 重置 → 临时密码 + 必须改密 + 旧会话失效', async () => {
    const res = await reset()
    expect(res.status).toBe(200)
    expect(res.body.data.temporaryPassword).toBeTruthy()
    expect(res.body.data.mustChangePassword).toBe(true)

    const { User } = TestDatabase.getSequelize().models
    const fresh = await User.findByPk(user.id)
    expect(fresh.must_reset_password).toBe(true)

    // 旧 token 失效（token_version 递增了）
    const oldToken = TestHelpers.generateToken(user)
    const useOld = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${oldToken}`)
    expect(useOld.status).toBe(401)
  })

  it('UR-2 临时密码能登录，登录响应带 must_reset_password', async () => {
    const res = await reset()
    const temp = res.body.data.temporaryPassword

    const login = await request(app).post('/api/users/login').send({
      country_code: user.country_code, phone: user.phone, password: temp
    })
    expect(login.status).toBe(200)
    expect(login.body.data.user.must_reset_password).toBe(true)
  })

  it('UR-3 用户不存在 → 404', async () => {
    const res = await reset(999999)
    expect(res.status).toBe(404)
  })

  it('UR-4 用户已禁用 → 400', async () => {
    const { User } = TestDatabase.getSequelize().models
    await User.update({ is_active: false }, { where: { id: user.id } })
    const res = await reset()
    expect(res.status).toBe(400)
  })

  it('UR-5 无效 id → 400', async () => {
    const res = await reset('abc')
    expect(res.status).toBe(400)
  })

  it('UR-6 未登录 → 401', async () => {
    const res = await request(app).put(`/api/admin/users/${user.id}/password`)
    expect([401, 403]).toContain(res.status)
  })

  it('UR-7 没有 users 权限的角色 → 403', async () => {
    const { Administrator } = TestDatabase.getSequelize().models
    // operator 有 users 权限（查/改），但**重置密码**应该更严：只允许 super_admin / admin
    const operator = await Administrator.create({
      username: `ur_op_${Date.now()}`,
      password: 'UrPwd#1234',
      role: 'operator',
      is_active: true
    })
    const token = TestHelpers.generateAdminToken(operator)
    const res = await request(app)
      .put(`/api/admin/users/${user.id}/password`)
      .set('Authorization', `Bearer ${token}`)
    // operator 可以查用户，但重置密码是账号级高危操作 → 不该放行
    expect([401, 403]).toContain(res.status)
  })

  it('UR-8 改完密码后 → 临时密码失效，标记清掉', async () => {
    const res = await reset()
    const temp = res.body.data.temporaryPassword

    const login = await request(app).post('/api/users/login').send({
      country_code: user.country_code, phone: user.phone, password: temp
    })
    expect(login.status).toBe(200)
    const userToken = login.body.data.token

    // 用户自己改密
    const changed = await request(app)
      .put('/api/users/profile/password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ old_password: temp, new_password: 'FinalPwd#2026' })
    expect(changed.status).toBe(200)

    const { User } = TestDatabase.getSequelize().models
    const fresh = await User.findByPk(user.id)
    expect(fresh.must_reset_password).toBe(false)
    expect(await fresh.validatePassword('FinalPwd#2026')).toBe(true)
    // 临时密码不再能登录
    const oldLogin = await request(app).post('/api/users/login').send({
      country_code: user.country_code, phone: user.phone, password: temp
    })
    expect(oldLogin.status).toBe(401)
  })

  it('UR-9 临时密码的格式：12 位，含大小写/数字/特殊字符，不含易混字符', async () => {
    const res = await reset()
    const pwd = res.body.data.temporaryPassword
    expect(pwd.length).toBe(12)
    expect(pwd).toMatch(/[A-Z]/)
    expect(pwd).toMatch(/[a-z]/)
    expect(pwd).toMatch(/[0-9]/)
    expect(pwd).toMatch(/[!@#$%&*]/)
    // 不含易混字符（这密码要线下口头告知，敲错很常见）
    expect(pwd).not.toMatch(/[0O1lI]/)
  })
})
