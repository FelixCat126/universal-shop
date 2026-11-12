/**
 * 鉴权边界修复的回归
 *
 *   SX-1 异步导出任务：partner_orders 类型要求 partners 权限（操作员没有 → 403）
 *   SX-2 异步导出任务：partners 类型要求 partners 权限（操作员没有 → 403）
 *   SX-3 异步导出任务：products 类型要求 products 权限
 *   SX-4 异步导出任务：orders 类型仍按 orders 权限（操作员有 → 允许）
 *   SX-5 下载时也复核权限（角色被降级后不能继续下载）
 *   SX-6 强制改密：/api/auth/profile 也要被拦（别名路径不是绕过口）
 *   SX-7 强制改密：/api/users/profile 正常被拦
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let operatorToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `sx_admin_${Date.now()}`,
    password: 'SxPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)

  const operator = await Administrator.create({
    username: `sx_op_${Date.now()}`,
    password: 'SxPwd#1234',
    role: 'operator', // ROLE_PERMISSIONS: orders / users / products —— **没有 partners**
    is_active: true
  })
  operatorToken = TestHelpers.generateAdminToken(operator)
})

/** 提交一个异步导出任务 */
function submitJob (token, type) {
  return request(app).post('/api/admin/export/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({ type })
}

describe('异步导出任务的权限边界', () => {
  it('SX-1 partner_orders → 操作员没有 partners 权限 → 403', async () => {
    const res = await submitJob(operatorToken, 'partner_orders')
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  it('SX-2 partners → 操作员没有 partners 权限 → 403', async () => {
    const res = await submitJob(operatorToken, 'partners')
    expect(res.status).toBe(403)
  })

  it('SX-3 products → 按 products 权限判定（操作员有 → 允许）', async () => {
    const res = await submitJob(operatorToken, 'products')
    expect(res.status).toBe(201)
  })

  it('SX-4 orders → 操作员有 orders 权限 → 允许', async () => {
    const res = await submitJob(operatorToken, 'orders')
    expect(res.status).toBe(201)
  })

  it('SX-5 下载时也复核权限（建任务后被降级 → 不能下载）', async () => {
    // 超管建一个 partners 类型的任务
    const created = await submitJob(adminToken, 'partners')
    expect(created.status).toBe(201)
    const jobId = created.body.data?.job?.id || created.body.data?.id
    expect(jobId).toBeTruthy()

    // 把建任务的管理员降级成 operator（失去 partners 权限）
    const { Administrator } = models()
    const admin = await Administrator.findOne({ where: { role: 'super_admin' } })
    expect(admin).toBeTruthy()
    await admin.update({ role: 'operator' })

    const dl = await request(app).get(`/api/admin/export/jobs/${jobId}/download`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(dl.status).toBe(403)
  })
})

describe('强制改密守卫不能被别名路径绕过', () => {
  async function userNeedingReset () {
    const { User } = models()
    const u = await User.create({
      username: 'sx_reset_user',
      nickname: '待改密用户',
      phone: '812349990',
      country_code: '+66',
      password: 'Abcd1234',
      must_reset_password: true,
      is_active: true
    })
    return { user: u, token: TestHelpers.generateToken(u) }
  }

  it('SX-6 /api/auth/profile 也要被拦（别名路径不是绕过口）', async () => {
    const { token } = await userNeedingReset()
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '改名了', email: 'attacker@evil.com' })

    expect(res.status, '走别名路径也必须被强制改密拦住').toBe(403)
  })

  it('SX-7 /api/users/profile 正常被拦', async () => {
    const { token } = await userNeedingReset()
    const res = await request(app)
      .put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '改名了', email: 'attacker@evil.com' })

    expect(res.status).toBe(403)
  })
})
