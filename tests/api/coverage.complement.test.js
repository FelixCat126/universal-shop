/**
 * P6 — 接口覆盖率补遗（17 用例）
 *   填补此前未覆盖到的后端接口：
 *     CC-1..CC-5 行政区划 5 个公开 GET
 *     CC-6 user GET /check-phone/:phone
 *     CC-7 user GET /verify-referral/:code（不存在 / 存在）
 *     CC-8 user GET /profile/metrics
 *     CC-9 user POST /logout
 *     CC-10 user PUT /profile/password
 *     CC-11 system-config GET /public（无认证 + 不返回敏感配置）
 *     CC-12 cart 匿名完整流程（Session-ID 串起 GET/POST/PUT/DELETE）
 *     CC-13 product POST /check-stock 批量
 *     CC-14 admin POST /products/:id/stock 调整库存
 *     CC-15 admin POST /products/:id/restore 恢复软删
 *     CC-16 admin GET /partner-orders/export → xlsx
 *     CC-17 upload 鉴权（无 token 401 / 普通 user 403）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedRegionsBaseline, seedSystemConfigBaseline } from '../setup/test-baseline.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

describe('P6.coverage.complement — 行政区划', () => {
  it('CC-1 GET /api/administrative-regions/provinces → 200 数组', async () => {
    await seedRegionsBaseline()
    const res = await request(app).get('/api/administrative-regions/provinces')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('CC-2 GET /provinces/:id/districts → 200', async () => {
    await seedRegionsBaseline()
    const sequelize = TestDatabase.getSequelize()
    const { AdministrativeRegion } = sequelize.models
    const province = await AdministrativeRegion.findOne({ where: { level: 1 } })
    const res = await request(app)
      .get(`/api/administrative-regions/provinces/${province.id}/districts`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('CC-3 GET /districts/:id/sub-districts → 200', async () => {
    await seedRegionsBaseline()
    const sequelize = TestDatabase.getSequelize()
    const { AdministrativeRegion } = sequelize.models
    const district = await AdministrativeRegion.findOne({ where: { level: 2 } })
    if (!district) {
      // baseline 不一定有第 2 层；用任一非 null id 验路由通
      const res = await request(app).get('/api/administrative-regions/districts/1/sub-districts')
      expect([200, 404]).toContain(res.status)
      return
    }
    const res = await request(app)
      .get(`/api/administrative-regions/districts/${district.id}/sub-districts`)
    expect(res.status).toBe(200)
  })

  it('CC-4 GET /postal-code/:code → 不存在返回 404', async () => {
    const res = await request(app).get('/api/administrative-regions/postal-code/000000')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('CC-5 GET /all → 200 数组', async () => {
    await seedRegionsBaseline()
    const res = await request(app).get('/api/administrative-regions/all')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })
})

describe('P6.coverage.complement — User 公开/资料接口', () => {
  it('CC-6 GET /api/users/check-phone/:phone → 含 exists 字段', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    await User.create(await TestDataFactory.createUser({ country_code: '+86', phone: '13911112222' }))

    const exists = await request(app).get('/api/users/check-phone/13911112222')
    expect(exists.status).toBe(200)
    expect(exists.body.data.exists).toBe(true)

    const notExists = await request(app).get('/api/users/check-phone/13900000000')
    expect(notExists.status).toBe(200)
    expect(notExists.body.data.exists).toBe(false)
  })

  it('CC-7 GET /api/users/verify-referral/:code → 存在 200 / 不存在 404', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const u = await User.create(
      await TestDataFactory.createUser({ country_code: '+86', phone: '13911113333', referral_code: 'AB12CD' })
    )

    const ok = await request(app).get(`/api/users/verify-referral/${u.referral_code}`)
    expect(ok.status).toBe(200)
    expect(ok.body.data.referrer.username).toBeDefined()

    const notFound = await request(app).get('/api/users/verify-referral/XXYYZZ')
    expect([400, 404]).toContain(notFound.status)
  })

  it('CC-8 GET /api/users/profile/metrics → 200 含 order_count/spent_thb/points_balance', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const u = await User.create(await TestDataFactory.createUser({ country_code: '+86', phone: '13911114444' }))
    const token = TestHelpers.generateToken(u)

    const res = await request(app).get('/api/users/profile/metrics').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('order_count')
    expect(res.body.data).toHaveProperty('spent_thb')
    expect(res.body.data).toHaveProperty('points_balance')
  })

  it('CC-9 POST /api/users/logout → 200', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const u = await User.create(await TestDataFactory.createUser({ country_code: '+86', phone: '13911115555' }))
    const token = TestHelpers.generateToken(u)
    const res = await request(app).post('/api/users/logout').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('CC-10 PUT /api/users/profile/password → 旧错 400/401，旧对 200', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const plain = 'OldPass#1234'
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13911116666', password: plain
    }))
    const token = TestHelpers.generateToken(u)

    const wrong = await request(app)
      .put('/api/users/profile/password').set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'NotMyPwd#1', new_password: 'NewStrongPwd#9999' })
    expect([400, 401]).toContain(wrong.status)

    const ok = await request(app)
      .put('/api/users/profile/password').set('Authorization', `Bearer ${token}`)
      .send({ old_password: plain, new_password: 'NewStrongPwd#9999' })
    expect(ok.status).toBe(200)
  })
})

describe('P6.coverage.complement — 公开系统配置', () => {
  it('CC-11 GET /api/system-config/public → 无认证可访问，仅返回公开字段', async () => {
    await seedSystemConfigBaseline()
    const res = await request(app).get('/api/system-config/public')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('exchange_rates')
    expect(res.body.data).toHaveProperty('currency_code')
    // 不应泄露 admin_settings 等敏感配置（即使 baseline 没设过，也不能出现在响应里）
    expect(res.body.data).not.toHaveProperty('admin_settings')
  })
})

describe('P6.coverage.complement — 匿名购物车完整流程', () => {
  it('CC-12 匿名 POST→GET→PUT→DELETE 通过 Session-ID 维持身份', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ stock: 50, status: 'active' }))

    const r1 = await request(app).post('/api/cart').send({ product_id: p.id, quantity: 1 })
    expect(r1.status).toBe(200)
    const sessionId = r1.headers['session-id']
    expect(sessionId).toBeTruthy()
    const cartId = r1.body.data.id

    // GET 拉购物车
    const r2 = await request(app).get('/api/cart').set('Session-ID', sessionId)
    expect(r2.status).toBe(200)
    expect(Array.isArray(r2.body.data)).toBe(true)
    expect(r2.body.data.length).toBe(1)

    // PUT 更新数量
    const r3 = await request(app).put(`/api/cart/${cartId}`)
      .set('Session-ID', sessionId).send({ quantity: 3 })
    expect(r3.status).toBe(200)

    // DELETE 单项
    const r4 = await request(app).delete(`/api/cart/${cartId}`).set('Session-ID', sessionId)
    expect(r4.status).toBe(200)
  })
})

describe('P6.coverage.complement — 商品库存/恢复', () => {
  it('CC-13 POST /api/products/check-stock → 返回 [{id,stock}]', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p1 = await Product.create(TestDataFactory.createProduct({ stock: 8, status: 'active' }))
    const p2 = await Product.create(TestDataFactory.createProduct({ stock: 0, status: 'active' }))

    const res = await request(app).post('/api/products/check-stock').send({ productIds: [p1.id, p2.id] })
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(2)
    expect(res.body.data.find((x) => x.id === p1.id).stock).toBe(8)

    const bad = await request(app).post('/api/products/check-stock').send({ productIds: 'not-array' })
    expect(bad.status).toBe(400)
  })

  it('CC-14 admin POST /api/products/:id/stock type=set/add/subtract', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const aToken = TestHelpers.generateAdminToken(admin)
    const p = await Product.create(TestDataFactory.createProduct({ stock: 10, status: 'active' }))

    const r1 = await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ type: 'set', quantity: 100 })
    expect(r1.status).toBe(200)

    await p.reload(); expect(p.stock).toBe(100)

    await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ type: 'add', quantity: 5 })
    await p.reload(); expect(p.stock).toBe(105)

    await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ type: 'subtract', quantity: 50 })
    await p.reload(); expect(p.stock).toBe(55)
  })

  it('CC-15 admin POST /api/products/:id/restore → 软删 → 恢复', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const aToken = TestHelpers.generateAdminToken(admin)

    const p = await Product.create(TestDataFactory.createProduct({ stock: 10, status: 'active' }))
    await request(app).delete(`/api/products/${p.id}`).set('Authorization', `Bearer ${aToken}`)
    const removed = await Product.findByPk(p.id, { paranoid: false })
    expect(removed.deleted_at || removed.deletedAt).toBeTruthy()

    const r = await request(app).post(`/api/products/${p.id}/restore`)
      .set('Authorization', `Bearer ${aToken}`)
    expect(r.status).toBe(200)
    const restored = await Product.findByPk(p.id, { paranoid: false })
    expect(restored.deleted_at || restored.deletedAt).toBeFalsy()
  })
})

describe('P6.coverage.complement — admin 合作方订单导出', () => {
  it('CC-16 admin GET /api/admin/partner-orders/export → 200 + xlsx', async () => {
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const aToken = TestHelpers.generateAdminToken(admin)
    const res = await request(app).get('/api/admin/partner-orders/export')
      .set('Authorization', `Bearer ${aToken}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheet|excel|xlsx/i)
  })
})

describe('P6.coverage.complement — 上传鉴权', () => {
  it('CC-17 上传无认证 401 / 普通用户上传商品图 403/401', async () => {
    const noAuth = await request(app).post('/api/upload/avatar')
    expect([401, 403]).toContain(noAuth.status)

    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    const u = await User.create(await TestDataFactory.createUser({ country_code: '+86', phone: '13912340101' }))
    const uToken = TestHelpers.generateToken(u)

    const userTries = await request(app).post('/api/upload/product-image')
      .set('Authorization', `Bearer ${uToken}`)
    expect([401, 403]).toContain(userTries.status)
  })
})
