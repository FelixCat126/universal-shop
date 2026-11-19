/**
 * P3 Admin — 合作方（7 用例）
 *   AT-1 GET /api/admin/partners 列表 happy
 *   AT-2 POST 创建合作方 → 201
 *   AT-3 POST 登录名重复 → 400
 *   AT-4 PUT /:id 修改 discount_percent
 *   AT-5 PUT /:id/password 重置密码 → 200
 *   AT-6 GET /api/admin/partner-orders 列表
 *   AT-7 PUT /api/admin/partner-orders/:id/status 改状态
 *   AT-8 合作方列表分页（第 36 轮补：原来一次性拉全量，与其它后台页形态不一致）
 *   AT-9 合作方列表关键词筛选
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return { token: TestHelpers.generateAdminToken(admin) }
}

describe('P3.admin.partner', () => {
  it('AT-1 GET 列表 happy', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner } = sequelize.models
    await Partner.create(TestDataFactory.createPartner())
    await Partner.create(TestDataFactory.createPartner())
    const res = await request(app).get('/api/admin/partners')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(2)
    expect(res.body.data[0].password).toBeUndefined()
  })

  it('AT-2 POST 创建合作方 → 201', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/admin/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({ login: 'newpartner001', password: 'pwd12345', display_name: 'X', discount_percent: 25 })
    expect(res.status).toBe(201)
    expect(res.body.data.login).toBe('newpartner001')
  })

  it('AT-3 POST 登录名重复 → 400', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner } = sequelize.models
    const existing = await Partner.create(TestDataFactory.createPartner({ login: 'dup_login' }))

    const res = await request(app).post('/api/admin/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({ login: existing.login, password: 'pwd12345' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/已存在/)
  })

  it('AT-4 PUT /:id 修改 discount_percent', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner } = sequelize.models
    const p = await Partner.create(TestDataFactory.createPartner({ discount_percent: 10 }))
    const res = await request(app).put(`/api/admin/partners/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ discount_percent: 35 })
    expect(res.status).toBe(200)
    expect(parseFloat(res.body.data.discount_percent)).toBe(35)
  })

  it('AT-5 PUT /:id/password 重置密码 → 200', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner } = sequelize.models
    const p = await Partner.create(TestDataFactory.createPartner())

    const res = await request(app).put(`/api/admin/partners/${p.id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'newpwd456' })
    expect(res.status).toBe(200)

    // 用新密码登录
    const login = await request(app).post('/api/partner/login').send({
      login: p.login, password: 'newpwd456'
    })
    expect(login.status).toBe(200)
  })

  it('AT-6 GET /api/admin/partner-orders 列表', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner, PartnerOrder } = sequelize.models
    const p = await Partner.create(TestDataFactory.createPartner())
    await PartnerOrder.create(TestDataFactory.createPartnerOrder(p.id))

    const res = await request(app).get('/api/admin/partner-orders')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.orders.length).toBe(1)
  })

  it('AT-8 合作方列表分页', async () => {
    const { token } = await adminCtx()
    const { Partner } = TestDatabase.getSequelize().models
    for (let i = 0; i < 25; i++) {
      await Partner.create(TestDataFactory.createPartner({ login: `pg_partner_${i}`, display_name: `分页测试${i}` }))
    }

    const res = await request(app).get('/api/admin/partners?page=2&pageSize=10')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.length, '第 2 页应有 10 条').toBe(10)
    expect(res.body.pagination.total, '总数应为 25').toBe(25)
    expect(res.body.pagination.page).toBe(2)
    expect(res.body.pagination.pageSize).toBe(10)
    expect(res.body.pagination.totalPages).toBe(3)

    // pageSize 超上限要被钳住（统一分页工具）
    const big = await request(app).get('/api/admin/partners?pageSize=99999')
      .set('Authorization', `Bearer ${token}`)
    expect(big.status).toBe(200)
    expect(big.body.pagination.pageSize, 'pageSize 应被钳到上限 100').toBe(100)
  })

  it('AT-9 合作方列表关键词筛选', async () => {
    const { token } = await adminCtx()
    const { Partner } = TestDatabase.getSequelize().models
    await Partner.create(TestDataFactory.createPartner({ login: 'kw_alpha', display_name: '甲公司' }))
    await Partner.create(TestDataFactory.createPartner({ login: 'kw_beta', display_name: '乙公司' }))

    const res = await request(app).get('/api/admin/partners?keyword=kw_alpha')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.length, '只应命中 1 条').toBe(1)
    expect(res.body.data[0].login).toBe('kw_alpha')
    expect(res.body.pagination.total).toBe(1)
  })

  it('AT-7 PUT /partner-orders/:id/status 改状态', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner, PartnerOrder } = sequelize.models
    const p = await Partner.create(TestDataFactory.createPartner())
    const o = await PartnerOrder.create(TestDataFactory.createPartnerOrder(p.id, { status: 'processing' }))

    const res = await request(app).put(`/api/admin/partner-orders/${o.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('shipped')
  })
})
