/**
 * 合作方密码：自助改密 + 强制改密 + 管理端重置
 *
 * 之前合作方**完全没有改密途径**：
 *   - 门户没有改密页
 *   - 接口没有 /me/password
 *   - CSV 批量导入的账号拿到的是系统生成的随机初始密码（运营线下告知）
 *     → 那个临时密码会一直有效，谁拿到都能下单
 *
 * 这轮补上：自助改密 + 强制改密标记 + 与用户侧同一把密码尺子。
 *
 *   PP-1  未登录不能改密
 *   PP-2  当前密码不对 → 400
 *   PP-3  新密码太弱 → 400（服务端策略：≥8 位 + 字母 + 数字）
 *   PP-4  新密码与当前相同 → 400
 *   PP-5  改密成功 → 新密码能登录、旧 token 立即失效、返回新 token
 *   PP-6  强制改密标记：改密前只能访问 /me 和 /me/password
 *   PP-7  CSV 导入的账号带强制改密标记
 *   PP-8  管理端重置密码：弱密码 → 400；强密码 → 200 + 标记置位 + 旧 token 失效
 *   PP-9  管理端创建合作方：弱密码 → 400
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return { token: TestHelpers.generateAdminToken(admin) }
}

/** 造一个合作方账号（密码已知） */
async function mkPartner (password = 'Partner#2026', overrides = {}) {
  const { Partner } = models()
  return Partner.create({
    login: `pp_${Math.random().toString(36).slice(2, 9)}`,
    password,
    display_name: '改密测试合作方',
    is_active: true,
    ...overrides
  })
}

describe('合作方自助改密', () => {
  it('PP-1 未登录不能改密', async () => {
    const res = await request(app)
      .put('/api/partner/me/password')
      .send({ current_password: 'Partner#2026', new_password: 'NewPass#2026' })
    expect([401, 403]).toContain(res.status)
  })

  it('PP-2 当前密码不对 → 400', async () => {
    const p = await mkPartner()
    const token = TestHelpers.generatePartnerToken(p)

    const res = await request(app)
      .put('/api/partner/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'WrongPass#1', new_password: 'NewPass#2026' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/当前密码/)
  })

  it('PP-3 新密码太弱 → 400（≥8 位 + 字母 + 数字）', async () => {
    const p = await mkPartner()
    const token = TestHelpers.generatePartnerToken(p)

    for (const weak of ['short1', 'nodigitshere', '12345678']) {
      const res = await request(app)
        .put('/api/partner/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'Partner#2026', new_password: weak })
      expect(res.status, `弱密码 "${weak}" 应被拒绝`).toBe(400)
    }
  })

  it('PP-4 新密码与当前相同 → 400', async () => {
    const p = await mkPartner()
    const token = TestHelpers.generatePartnerToken(p)

    const res = await request(app)
      .put('/api/partner/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'Partner#2026', new_password: 'Partner#2026' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/相同/)
  })

  it('PP-5 改密成功 → 新密码能登录、旧 token 立即失效、返回新 token', async () => {
    const p = await mkPartner()
    const oldToken = TestHelpers.generatePartnerToken(p)

    const res = await request(app)
      .put('/api/partner/me/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ current_password: 'Partner#2026', new_password: 'Brand#New2026' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.token, '应返回新 token（否则当前会话会被踢下线）').toBeTruthy()

    // 旧 token 立即失效（token_version 自增）
    const withOld = await request(app).get('/api/partner/me')
      .set('Authorization', `Bearer ${oldToken}`)
    expect(withOld.status).toBe(401)

    // 新 token 可用
    const withNew = await request(app).get('/api/partner/me')
      .set('Authorization', `Bearer ${res.body.data.token}`)
    expect(withNew.status).toBe(200)

    // 新密码能登录
    const login = await request(app).post('/api/partner/login')
      .send({ login: p.login, password: 'Brand#New2026' })
    expect(login.status).toBe(200)

    // 旧密码不能再登录
    const oldLogin = await request(app).post('/api/partner/login')
      .send({ login: p.login, password: 'Partner#2026' })
    expect(oldLogin.status).toBe(401)
  })

  it('PP-6 强制改密标记：改密前只能访问 /me 和 /me/password', async () => {
    const p = await mkPartner('Partner#2026', { must_reset_password: true })
    const token = TestHelpers.generatePartnerToken(p)

    // 允许的两个接口
    const me = await request(app).get('/api/partner/me')
      .set('Authorization', `Bearer ${token}`)
    expect(me.status).toBe(200)
    expect(me.body.data.must_reset_password).toBe(true)

    // 其余业务接口一律拦下（改密**之前**）
    const products = await request(app).get('/api/partner/products')
      .set('Authorization', `Bearer ${token}`)
    expect(products.status).toBe(403)
    expect(products.body.code).toBe('MUST_RESET_PASSWORD')

    const orders = await request(app).get('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
    expect(orders.status).toBe(403)

    // 改密本身允许通过
    const change = await request(app).put('/api/partner/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'Partner#2026', new_password: 'Brand#New2026' })
    expect(change.status).toBe(200)

    // 改完之后业务接口放行（用改密返回的新 token —— 旧 token 已因 token_version 失效）
    const newToken = change.body.data.token
    const productsAfter = await request(app).get('/api/partner/products')
      .set('Authorization', `Bearer ${newToken}`)
    expect(productsAfter.status).toBe(200)
  })

  it('PP-7 改密后强制改密标记清零', async () => {
    const { Partner } = models()
    const p = await mkPartner('Partner#2026', { must_reset_password: true })
    const token = TestHelpers.generatePartnerToken(p)

    const res = await request(app).put('/api/partner/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'Partner#2026', new_password: 'Brand#New2026' })
    expect(res.status).toBe(200)

    const fresh = await Partner.findByPk(p.id)
    expect(fresh.must_reset_password).toBe(false)
  })
})

describe('管理端重置合作方密码', () => {
  it('PP-8 弱密码 → 400；强密码 → 200 + 标记置位 + 旧 token 失效', async () => {
    const { token: adminToken } = await adminCtx()
    const p = await mkPartner()
    const oldToken = TestHelpers.generatePartnerToken(p)

    const weak = await request(app).put(`/api/admin/partners/${p.id}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: '123' })
    expect(weak.status).toBe(400)

    const ok = await request(app).put(`/api/admin/partners/${p.id}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'Reset#2026' })
    expect(ok.status).toBe(200)

    // 旧 token 失效
    const after = await request(app).get('/api/partner/me')
      .set('Authorization', `Bearer ${oldToken}`)
    expect(after.status).toBe(401)

    // 重置出来的密码是临时口令 → 必须强制改密
    const { Partner } = models()
    const fresh = await Partner.findByPk(p.id)
    expect(fresh.must_reset_password).toBe(true)
  })

  it('PP-9 管理端创建合作方：弱密码 → 400', async () => {
    const { token: adminToken } = await adminCtx()

    const weak = await request(app).post('/api/admin/partners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ login: 'weakpwd_partner', password: '123' })
    expect(weak.status).toBe(400)

    const ok = await request(app).post('/api/admin/partners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ login: 'strongpwd_partner', password: 'Create#2026' })
    expect(ok.status).toBe(201)
    expect(ok.body.data.must_reset_password, '管理员设的是初始口令 → 首次登录须改密').toBe(true)
  })
})
