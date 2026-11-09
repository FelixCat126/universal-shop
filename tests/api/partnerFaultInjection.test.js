/**
 * 故障注入（合作方门户）：盖住"只有出错时才走"的分支
 *
 * 合作方是**独立的钱路**（批发订货），它的错误分支同样不能靠运气测到。
 *
 *   PF-1 订单列表查询失败 → 500
 *   PF-2 订单详情查询失败 → 500
 *   PF-3 地址列表查询失败 → 500
 *   PF-4 地址创建失败 → 500
 *   PF-5 地址更新失败 → 500
 *   PF-6 订单号撞库 → 重试（最多 5 次）
 *   PF-7 死锁(40P01) → 重试后成功
 *   PF-8 死锁超过重试次数 → 500
 *   PF-9 订单详情：订单不存在 → 404
 *   PF-10 订单详情：别人的订单 → 404
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { pgError, injectFault, failOnce, failTimes, restoreFaults } from '../helpers/faultInjection.js'

let partner
let token
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models
  category = await ProductCategory.create({ name: '合作方故障分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '合作方故障商品', price: 100, stock: 1000, category_id: category.id
  }))
  const created = await TestHelpers.createPartnerWithAddress()
  partner = created.partner
  token = created.token
})

afterEach(() => {
  restoreFaults()
})

/** 造一张合作方订单 */
async function makeOrder (extra = {}) {
  const { PartnerOrder, PartnerOrderItem } = TestDatabase.getSequelize().models
  const order = await PartnerOrder.create({
    partner_id: partner.id,
    partner_address_id: null,
    order_no: `PF${Date.now()}${Math.floor(Math.random() * 1000)}`,
    status: 'submitted',
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    ...extra
  })
  await PartnerOrderItem.create({
    partner_order_id: order.id,
    product_id: product.id,
    quantity: 50,
    base_unit_thb: 100,
    unit_price_thb: 100,
    line_total_thb: 5000,
    partner_discount_percent_snapshot: 0,
    product_name_snapshot: product.name
  })
  return order
}

describe('合作方门户的故障分支', () => {
  it('PF-1 订单列表查询失败 → 500', async () => {
    const { PartnerOrder } = TestDatabase.getSequelize().models
    injectFault(PartnerOrder, 'findAll', new Error('db down'))

    const res = await request(app)
      .get('/api/partner/orders').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })

  it('PF-2 订单详情查询失败 → 500', async () => {
    const order = await makeOrder()
    const { PartnerOrder } = TestDatabase.getSequelize().models
    injectFault(PartnerOrder, 'findOne', new Error('db down'))

    const res = await request(app)
      .get(`/api/partner/orders/${order.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(500)
  })

  it('PF-3 地址列表查询失败 → 500', async () => {
    const { PartnerAddress } = TestDatabase.getSequelize().models
    injectFault(PartnerAddress, 'findAll', new Error('db down'))

    const res = await request(app)
      .get('/api/partner/addresses').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(500)
  })

  it('PF-4 地址创建失败 → 500', async () => {
    const { PartnerAddress } = TestDatabase.getSequelize().models
    injectFault(PartnerAddress, 'create', new Error('db down'))

    const res = await request(app)
      .post('/api/partner/addresses').set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: 'x', phone: '0899999999', detail: '地址' })
    expect(res.status).toBe(500)
  })

  it('PF-5 地址更新失败 → 500', async () => {
    const { PartnerAddress } = TestDatabase.getSequelize().models
    const address = await PartnerAddress.findOne({ where: { partner_id: partner.id } })
    injectFault(PartnerAddress, 'findOne', new Error('db down'))

    const res = await request(app)
      .put(`/api/partner/addresses/${address.id}`).set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: '改一下' })
    expect(res.status).toBe(500)
  })

  it('PF-6 订单号撞库 → 重试（最多 5 次）', async () => {
    const { PartnerOrder } = TestDatabase.getSequelize().models
    // 前两次撞订单号的唯一索引（带上约束名，业务代码才认得出是"订单号撞库"）
    const conflict = pgError('23505', 'duplicate key value', {
      constraint: 'partner_orders_order_no_key',
      fields: { order_no: 'X' }
    })
    failTimes(PartnerOrder, 'create', conflict, 2)

    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send({
        partner_address_id: (await TestDatabase.getSequelize().models.PartnerAddress.findOne({ where: { partner_id: partner.id } })).id,
        items: [{ product_id: product.id, quantity: 50 }]
      })
    expect(res.status).toBe(201)
  })

  it('PF-7 死锁(40P01) → 重试后成功', async () => {
    const { PartnerOrder } = TestDatabase.getSequelize().models
    failOnce(PartnerOrder, 'create', pgError('40P01', 'deadlock detected'))

    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send({
        partner_address_id: (await TestDatabase.getSequelize().models.PartnerAddress.findOne({ where: { partner_id: partner.id } })).id,
        items: [{ product_id: product.id, quantity: 50 }]
      })
    expect(res.status).toBe(201)
  })

  it('PF-8 死锁超过重试次数 → 500', async () => {
    const { PartnerOrder } = TestDatabase.getSequelize().models
    failTimes(PartnerOrder, 'create', pgError('40P01', 'deadlock detected'), 99)

    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send({
        partner_address_id: (await TestDatabase.getSequelize().models.PartnerAddress.findOne({ where: { partner_id: partner.id } })).id,
        items: [{ product_id: product.id, quantity: 50 }]
      })
    expect(res.status).toBe(500)
  })

  it('PF-9 订单详情：订单不存在 → 404', async () => {
    const res = await request(app)
      .get('/api/partner/orders/999999').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('PF-10 订单详情：别人的订单 → 404', async () => {
    const other = await TestHelpers.createPartnerWithAddress()
    const order = await makeOrder()
    const res = await request(app)
      .get(`/api/partner/orders/${order.id}`).set('Authorization', `Bearer ${other.token}`)
    expect(res.status).toBe(404)
  })
})
