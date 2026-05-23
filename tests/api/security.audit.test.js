/**
 * P5 — AuditLog 审计落库（3 用例）
 *   注：T-S5 已覆盖 user.login.fail / user.register.success。
 *   这里补充：
 *     AD-1 admin 登录失败 → 'admin.login.fail' 落库
 *     AD-2 partner 登录失败 → 'partner.login.fail' 落库
 *     AD-3 partner 下单成功 → 'partner_order.create' 落库（actorType=partner）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

describe('P5.security.audit', () => {
  it('AD-1 admin 登录失败 → admin.login.fail 落库', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { AuditLog } = sequelize.models
    const before = await AuditLog.count({ where: { event: 'admin.login.fail' } })

    await request(app)
      .post('/api/admin/login')
      .send({ username: 'no_such_admin', password: 'WrongPass#1234' })

    await new Promise((r) => setTimeout(r, 200))
    const after = await AuditLog.count({ where: { event: 'admin.login.fail' } })
    expect(after).toBeGreaterThan(before)
  })

  it('AD-2 partner 登录失败 → partner.login.fail 落库', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { AuditLog } = sequelize.models
    const before = await AuditLog.count({ where: { event: 'partner.login.fail' } })

    await request(app)
      .post('/api/partner/login')
      .send({ login: 'no_such_partner', password: 'WrongPass#1234' })

    await new Promise((r) => setTimeout(r, 200))
    const after = await AuditLog.count({ where: { event: 'partner.login.fail' } })
    expect(after).toBeGreaterThan(before)
  })

  it('AD-3 partner 下单成功 → partner_order.create 落库 (actor_type=partner)', async () => {
    await seedSystemConfigBaseline()
    const sequelize = TestDatabase.getSequelize()
    const { Product, AuditLog } = sequelize.models
    const { partner, token, address } = await TestHelpers.createPartnerWithAddress({ discount_percent: 0 })
    const product = await Product.create(
      TestDataFactory.createProduct({ price: 10, discount: null, stock: 1000, status: 'active' })
    )

    const before = await AuditLog.count({
      where: { event: 'partner_order.create', actor_type: 'partner', actor_id: String(partner.id) }
    })

    const r = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
    expect(r.status).toBe(201)

    await new Promise((r) => setTimeout(r, 250))
    const after = await AuditLog.count({
      where: { event: 'partner_order.create', actor_type: 'partner', actor_id: String(partner.id) }
    })
    expect(after).toBeGreaterThan(before)
  })
})
