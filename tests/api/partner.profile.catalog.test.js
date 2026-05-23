/**
 * P2 合作方 — me / 商品价目（3 用例）
 *   PP-1 GET /api/partner/me happy → 200，含 discount_percent
 *   PP-2 GET /api/partner/products 价目快照（折扣应用 + MOQ 配置回填）
 *   PP-3 未登录 → 401
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('P2.partner.profile_catalog', () => {
  it('PP-1 GET /api/partner/me happy', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress({
      discount_percent: 30
    })
    const res = await request(app).get('/api/partner/me')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(partner.id)
    expect(res.body.data.discount_percent).toBe(30)
  })

  it('PP-2 GET /api/partner/products 折扣价快照 + MOQ 配置回填', async () => {
    await seedSystemConfigBaseline({
      partner_order_moq_unit: 50,
      partner_order_moq_multiplier: 1
    })
    const { token } = await TestHelpers.createPartnerWithAddress({
      discount_percent: 20
    })
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p1 = await Product.create(
      TestDataFactory.createProduct({ price: 100, discount: null, status: 'active', stock: 1000 })
    )

    const res = await request(app).get('/api/partner/products')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBeGreaterThan(0)
    const found = res.body.data.products.find((p) => p.id === p1.id)
    expect(found).toBeTruthy()
    expect(found.unit_price_thb).toBe(80) // 100 * (1 - 20%)
    expect(found.moq_unit).toBe(50)
    expect(found.moq_multiplier).toBe(1)
    expect(found.discount_percent_applied).toBe(20)
  })

  it('PP-3 未登录 → 401', async () => {
    const res = await request(app).get('/api/partner/products')
    expect(res.status).toBe(401)
  })
})
