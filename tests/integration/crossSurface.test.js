/**
 * P4 — 跨端集成（10 用例）
 *   CS-1 admin 改 User.is_active=false → 旧 user token 立即 401（authMiddleware 校验 active）
 *   CS-2 admin 改汇率 → portal 下单立即生效（缓存 invalidate）
 *   CS-3 合作方下单 → admin 列表能看到 + AuditLog 落库 partner_order.create
 *   CS-4 admin 删商品分类（空）→ 之后该分类筛选返回空
 *   CS-5 admin 改 partners.discount_percent → 合作方下次下单快照变化
 *   CS-6 合作方被删后再用其旧 token → 401
 *   CS-7 危险操作：admin 删订单 → OperationLog 落库 delete_order
 *   CS-8 危险操作：admin 重置管理员密码 → OperationLog 落库 reset_password
 *   CS-9 危险操作：admin 删 system-config 项 → OperationLog 落库 delete
 *   CS-10 用户禁用后已存在订单 confirm-online-payment → 401（user token 校验失败）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { clearResponseCache } from '@server/utils/responseCache.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  clearResponseCache()
  _resetLoginGuardForTests()
})

async function adminToken (role = 'super_admin') {
  const a = await TestHelpers.createAdminUser({ role })
  return TestHelpers.generateAdminToken(a)
}

async function makeUserToken () {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  return { user: u, token: TestHelpers.generateToken(u) }
}

describe('P4.crossSurface', () => {
  it('CS-1 admin 禁用用户 → 用户旧 token 401', async () => {
    const aToken = await adminToken()
    const { user, token: uToken } = await makeUserToken()

    const ok = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${uToken}`)
    expect(ok.status).toBe(200)

    await request(app).put(`/api/admin/users/${user.id}/status`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ is_active: false })

    const blocked = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${uToken}`)
    expect([401, 403]).toContain(blocked.status)
  })

  it('CS-2 admin 改汇率 → portal 下单立即生效（写后无 30s 缓存）', async () => {
    const aToken = await adminToken()
    await seedSystemConfigBaseline({ exchange_rates: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })

    const { token: uToken } = await makeUserToken()
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, status: 'active' }))

    // 先把 CNY 改 0
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${aToken}`)
      .send({ key: 'exchange_rates', value: { USD: '0.03', CNY: '0', MYR: '0.13' } })

    const blocked = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${uToken}`)
      .send({
        contact_name: 'X', contact_phone: '+8613900100100', delivery_address: 'A',
        items: [{ product_id: p.id, quantity: 1 }], checkout_currency: 'CNY'
      })
    expect(blocked.status).toBe(400)

    // 改回 0.20
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${aToken}`)
      .send({ key: 'exchange_rates', value: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })

    const ok = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${uToken}`)
      .send({
        contact_name: 'X', contact_phone: '+8613900100101', delivery_address: 'A',
        items: [{ product_id: p.id, quantity: 1 }], checkout_currency: 'CNY'
      })
    expect(ok.status).toBe(201)
  })

  it('CS-3 合作方下单 → admin 列表能看到 + AuditLog 写入', async () => {
    await seedSystemConfigBaseline()
    const aToken = await adminToken()
    const { partner, token, address } = await TestHelpers.createPartnerWithAddress({ discount_percent: 0 })

    const sequelize = TestDatabase.getSequelize()
    const { Product, AuditLog } = sequelize.models
    const product = await Product.create(
      TestDataFactory.createProduct({ price: 10, discount: null, stock: 1000, status: 'active' })
    )

    const before = await AuditLog.count({ where: { event: 'partner_order.create' } })
    const r = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
    expect(r.status).toBe(201)

    const list = await request(app).get('/api/admin/partner-orders')
      .set('Authorization', `Bearer ${aToken}`)
    expect(list.status).toBe(200)
    expect(list.body.data.orders.find((o) => o.partner_id === partner.id)).toBeTruthy()

    await new Promise((r) => setTimeout(r, 200))
    const after = await AuditLog.count({ where: { event: 'partner_order.create' } })
    expect(after).toBeGreaterThan(before)
  })

  it('CS-4 admin 删空分类后筛选返回空', async () => {
    const aToken = await adminToken()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const cat = await ProductCategory.create(TestDataFactory.createProductCategory({ name: 'ToDel' }))

    await request(app).delete(`/api/admin/product-categories/${cat.id}`)
      .set('Authorization', `Bearer ${aToken}`)

    const res = await request(app).get(`/api/products?category_id=${cat.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(0)
  })

  it('CS-5 admin 改 partner.discount_percent → 合作方下次下单单价变化', async () => {
    await seedSystemConfigBaseline()
    const aToken = await adminToken()
    const { partner, token, address } = await TestHelpers.createPartnerWithAddress({ discount_percent: 0 })

    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const product = await Product.create(
      TestDataFactory.createProduct({ price: 100, discount: null, stock: 1000, status: 'active' })
    )

    const r1 = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
    expect(parseFloat(r1.body.data.items[0].unit_price_thb)).toBe(100)

    await request(app).put(`/api/admin/partners/${partner.id}`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ discount_percent: 40 })

    const r2 = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
    expect(parseFloat(r2.body.data.items[0].unit_price_thb)).toBe(60)
  })

  it('CS-6 合作方被删后旧 token 401', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress()
    const sequelize = TestDatabase.getSequelize()
    const { Partner, PartnerAddress } = sequelize.models
    await PartnerAddress.destroy({ where: { partner_id: partner.id } })
    await Partner.destroy({ where: { id: partner.id } })

    const res = await request(app).get('/api/partner/me').set('Authorization', `Bearer ${token}`)
    expect([401, 403]).toContain(res.status)
  })

  it('CS-7 admin 删订单 → OperationLog 落库 delete_order', async () => {
    const aToken = await adminToken()
    const sequelize = TestDatabase.getSequelize()
    const { User, Order, OperationLog } = sequelize.models
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13912340001'
    }))
    const o = await Order.create({
      order_no: `CS${Date.now()}`,
      user_id: u.id, total_amount: 100, total_amount_thb: 100, currency_code: 'THB',
      payment_method: 'cod', status: 'shipping',
      contact_name: 'X', contact_phone: '1', delivery_address: 'A', exchange_rate: 1
    })
    await request(app).delete(`/api/admin/orders/${o.id}`).set('Authorization', `Bearer ${aToken}`)
    await new Promise((r) => setTimeout(r, 250))
    const cnt = await OperationLog.count({ where: { action: 'delete_order' } })
    expect(cnt).toBeGreaterThanOrEqual(1)
  })

  it('CS-8 admin 重置管理员密码 → OperationLog 落库 reset_password', async () => {
    const aToken = await adminToken()
    const target = await TestHelpers.createAdminUser({ role: 'operator' })

    await request(app).put(`/api/admin/administrators/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ password: 'NewOpPwd#5678' })

    await new Promise((r) => setTimeout(r, 250))
    const sequelize = TestDatabase.getSequelize()
    const { OperationLog } = sequelize.models
    const cnt = await OperationLog.count({ where: { action: 'reset_password' } })
    expect(cnt).toBeGreaterThanOrEqual(1)
  })

  it('CS-9 admin 删 system-config → OperationLog 落库 delete', async () => {
    const aToken = await adminToken()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${aToken}`)
      .send({ key: 'currency_unit', value: 'CNY' })
    await request(app).delete('/api/system-config/currency_unit').set('Authorization', `Bearer ${aToken}`)

    await new Promise((r) => setTimeout(r, 250))
    const sequelize = TestDatabase.getSequelize()
    const { OperationLog } = sequelize.models
    const cnt = await OperationLog.count({ where: { action: 'delete', resource: 'system_config' } })
    expect(cnt).toBeGreaterThanOrEqual(1)
  })

  it('CS-10 用户被禁用后已存在订单的 confirm-online-payment → 401/403', async () => {
    const aToken = await adminToken()
    const { user, token: uToken } = await makeUserToken()

    const sequelize = TestDatabase.getSequelize()
    const { Order, OrderItem, Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ stock: 5, price: 100 }))
    const order = await Order.create({
      order_no: `CS10${Date.now()}`,
      user_id: user.id, total_amount: 100, total_amount_thb: 100, currency_code: 'THB',
      payment_method: 'online', status: 'pending',
      contact_name: 'X', contact_phone: '1', delivery_address: 'A', exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: p.id, quantity: 1, price: 100,
      original_price: 100, product_name_zh: p.name
    })

    await request(app).put(`/api/admin/users/${user.id}/status`)
      .set('Authorization', `Bearer ${aToken}`).send({ is_active: false })

    const res = await request(app).post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${uToken}`)
    expect([401, 403]).toContain(res.status)
  })
})
