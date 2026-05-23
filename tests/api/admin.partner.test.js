/**
 * P3 Admin — 合作方（7 用例）
 *   AT-1 GET /api/admin/partners 列表 happy
 *   AT-2 POST 创建合作方 → 201
 *   AT-3 POST 登录名重复 → 400
 *   AT-4 PUT /:id 修改 discount_percent
 *   AT-5 PUT /:id/password 重置密码 → 200
 *   AT-6 GET /api/admin/partner-orders 列表
 *   AT-7 PUT /api/admin/partner-orders/:id/status 改状态
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
      .send({ login: 'newpartner001', password: 'pwd1234', display_name: 'X', discount_percent: 25 })
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
      .send({ login: existing.login, password: 'pwd1234' })
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

  it('AT-7 PUT /partner-orders/:id/status 改状态', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner, PartnerOrder } = sequelize.models
    const p = await Partner.create(TestDataFactory.createPartner())
    const o = await PartnerOrder.create(TestDataFactory.createPartnerOrder(p.id, { status: 'submitted' }))

    const res = await request(app).put(`/api/admin/partner-orders/${o.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('shipped')
  })
})
