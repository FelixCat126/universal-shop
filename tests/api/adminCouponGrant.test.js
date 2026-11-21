/**
 * 管理端定向发券 / 作废券（7 用例）
 *
 * 固化这个功能的业务契约：
 *   AG-1 定向发券成功 → 用户券表多出对应券、状态可用（unused）、券码唯一
 *   AG-2 超出模板总量上限 → 400 且一张都没发出
 *   AG-3 超出每人限领 → 400 且一张都没发出
 *   AG-4 模板已停用 → 400（停用模板不能发）
 *   AG-5 作废未使用的券 → 状态变为已作废（void）
 *   AG-6 作废已使用的券 → 400（已核销的券不许作废）
 *   AG-7 用户侧 GET /api/coupons/mine 能看到「已作废」的券
 *
 * 另外固化两条边界：作废必须带原因（400）、无管理员令牌（401）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

async function makeUser (overrides = {}) {
  const { User } = models()
  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
  return { user, token: TestHelpers.generateToken(user) }
}

async function makeTemplate (overrides = {}) {
  const { CouponTemplate } = models()
  return CouponTemplate.create({
    name: '定向发券测试券',
    amount: 50,
    min_spend: 0,
    total: 100,
    per_user: 1,
    status: 'active',
    scope: { type: 'all', ids: [] },
    register_gift: false,
    valid_from: new Date(Date.now() - 3600_000),
    valid_to: new Date(Date.now() + 86400_000),
    ...overrides
  })
}

describe('P3.admin.couponGrant', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
  })

  it('AG-1 定向发券成功 → 用户券表多出对应券、状态可用、券码唯一', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate({ total: 10, per_user: 2 })
    const u1 = await makeUser()
    const u2 = await makeUser()

    const res = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_ids: [u1.user.id, u2.user.id], note: '老客户补偿' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.granted_count).toBe(2)
    expect(res.body.data.failed).toEqual([])

    const { UserCoupon } = models()
    const rows = await UserCoupon.findAll({ where: { template_id: tpl.id } })
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.status).toBe('unused')       // 发出的券立即可用
      expect(row.expire_at).toBeTruthy()      // 有效期取模板 valid_to
      expect(row.code).toMatch(/^CP[A-Z0-9]{10}$/)
    }
    // 券码唯一
    const codes = rows.map(r => r.code)
    expect(new Set(codes).size).toBe(2)
    // 每个用户各一张
    expect(rows.map(r => r.user_id).sort()).toEqual([u1.user.id, u2.user.id].sort())
  })

  it('AG-2 超出模板总量上限 → 400 且一张都没发出', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate({ total: 1, per_user: 5 })
    const u1 = await makeUser()
    const u2 = await makeUser()

    const res = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_ids: [u1.user.id, u2.user.id] })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(String(res.body.message)).toContain('总量')

    const { UserCoupon } = models()
    expect(await UserCoupon.count({ where: { template_id: tpl.id } })).toBe(0)
  })

  it('AG-3 超出每人限领 → 400 且一张都没发出', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate({ total: 100, per_user: 1 })
    const u1 = await makeUser()
    const u2 = await makeUser()

    // 先给 u1 发一张，把他的限领额度用掉
    const first = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_id: u1.user.id })
    expect(first.status).toBe(200)

    // 再给 u1 + u2 发：u1 已达限领上限 → 整批 400，u2 也不能拿到
    const res = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_ids: [u1.user.id, u2.user.id] })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(String(res.body.message)).toContain('限领')

    const { UserCoupon } = models()
    const rows = await UserCoupon.findAll({ where: { template_id: tpl.id } })
    expect(rows.length).toBe(1)            // 只剩第一次发的那张
    expect(rows[0].user_id).toBe(u1.user.id)
  })

  it('AG-4 模板已停用 → 400 且没发出', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate({ status: 'inactive' })
    const u1 = await makeUser()

    const res = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_id: u1.user.id })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(String(res.body.message)).toContain('停用')

    const { UserCoupon } = models()
    expect(await UserCoupon.count({ where: { template_id: tpl.id } })).toBe(0)
  })

  it('AG-5 作废未使用的券 → 状态变为已作废（void）', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate()
    const u1 = await makeUser()

    const grant = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_id: u1.user.id })
    expect(grant.status).toBe(200)
    const couponId = grant.body.data.granted[0].coupon_id

    const res = await request(app).post(`/api/admin/coupons/instances/${couponId}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '误发补偿' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const { UserCoupon } = models()
    const row = await UserCoupon.findByPk(couponId)
    expect(row.status).toBe('void')
    // 作废原因必须写（审计需要）
    const bad = await request(app).post(`/api/admin/coupons/instances/${couponId}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '' })
    expect(bad.status).toBe(400)
  })

  it('AG-6 作废已使用的券 → 400（已核销的券不许作废）', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate()
    const u1 = await makeUser()

    const { UserCoupon } = models()
    const used = await UserCoupon.create({
      template_id: tpl.id,
      user_id: u1.user.id,
      code: `USED${Date.now().toString(36).toUpperCase()}`,
      status: 'used',
      used_at: new Date()
    })

    const res = await request(app).post(`/api/admin/coupons/instances/${used.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '纠纷' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(String(res.body.message)).toContain('已使用')

    const row = await UserCoupon.findByPk(used.id)
    expect(row.status).toBe('used')        // 状态没被改
  })

  it('AG-7 用户侧 GET /api/coupons/mine 能看到「已作废」的券', async () => {
    const { token } = await adminCtx()
    const tpl = await makeTemplate()
    const u1 = await makeUser()

    const grant = await request(app).post('/api/admin/coupons/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id, user_id: u1.user.id })
    const couponId = grant.body.data.granted[0].coupon_id

    await request(app).post(`/api/admin/coupons/instances/${couponId}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '误发补偿' })

    // void 页签能看到
    const mine = await request(app).get('/api/coupons/mine?status=void')
      .set('Authorization', `Bearer ${u1.token}`)
    expect(mine.status).toBe(200)
    expect(mine.body.data.list.length).toBe(1)
    expect(mine.body.data.list[0].id).toBe(couponId)
    expect(mine.body.data.list[0].status).toBe('void')

    // 未使用页签里不该再出现它（已经作废）
    const unused = await request(app).get('/api/coupons/mine?status=unused')
      .set('Authorization', `Bearer ${u1.token}`)
    expect(unused.body.data.list.length).toBe(0)
  })

  it('AG-8 无管理员令牌 → 401', async () => {
    const tpl = await makeTemplate()
    const res = await request(app).post('/api/admin/coupons/grant')
      .send({ template_id: tpl.id, user_ids: [1] })
    expect(res.status).toBe(401)
  })
})
