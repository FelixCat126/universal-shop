/**
 * 合作方门户：地址字段更新 / 默认地址 / 支付竞态
 *
 *   PC-1 改地址：邮编超长 → 截断到 10 位
 *   PC-2 改地址：区号非法 → 归一化成 +66
 *   PC-3 改地址：清空收货人/电话/详细地址 → 400
 *   PC-4 改地址：设 is_default → 其它地址的默认标记被清掉（只有一个默认）
 *   PC-5 确认付款：affected=0 且订单已被并发删 → 404
 *   PC-6 确认付款：affected=0 但并发确认已生效 → 幂等成功
 *   PC-7 确认付款：affected=0 且状态被改走 → 409
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'

let partner
let token
let address
let product

beforeEach(async () => {
  vi.restoreAllMocks()
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models
  const cat = await ProductCategory.create({ name: '合作方地址分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '合作方地址商品', price: 100, stock: 1000, category_id: cat.id
  }))
  const created = await TestHelpers.createPartnerWithAddress()
  partner = created.partner
  token = created.token
  address = created.address
})

/** 造一张合作方订单 */
async function makeOrder (extra = {}) {
  const { PartnerOrder, PartnerOrderItem } = TestDatabase.getSequelize().models
  const order = await PartnerOrder.create({
    partner_id: partner.id,
    partner_address_id: address.id,
    order_no: `PC${Date.now()}${Math.floor(Math.random() * 1000)}`,
    status: 'pending_payment',
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

describe('合作方地址字段更新', () => {
  it('PC-1 邮编超长 → 截断到 10 位', async () => {
    const res = await request(app)
      .put(`/api/partner/addresses/${address.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ postal_code: '12345678901234567890' })
    expect(res.status).toBe(200)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    const fresh = await PartnerAddress.findByPk(address.id)
    expect(fresh.postal_code.length).toBe(10)
  })

  it('PC-2 区号非法 → 归一化成 +66', async () => {
    const res = await request(app)
      .put(`/api/partner/addresses/${address.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone_country_code: '+81' })
    expect(res.status).toBe(200)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    const fresh = await PartnerAddress.findByPk(address.id)
    expect(fresh.phone_country_code).toBe('+66')
  })

  it('PC-3 清空收货人/电话/详细地址 → 400', async () => {
    for (const body of [{ recipient_name: '' }, { phone: '' }, { detail: '' }]) {
      const res = await request(app)
        .put(`/api/partner/addresses/${address.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('PC-4 设 is_default → 只有一个默认地址', async () => {
    // 再建一个地址
    const created = await request(app)
      .post('/api/partner/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipient_name: '第二个收货人',
        phone: '0899999999',
        phone_country_code: '+66',
        detail: '第二个地址'
      })
    expect(created.status).toBe(201)

    const res = await request(app)
      .put(`/api/partner/addresses/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_default: true })
    expect(res.status).toBe(200)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    const defaults = await PartnerAddress.findAll({
      where: { partner_id: partner.id, is_default: true }
    })
    expect(defaults.length).toBe(1)
    expect(defaults[0].id).toBe(created.body.data.id)
  })
})

describe('合作方确认付款的竞态甄别', () => {
  it('PC-5 affected=0 且订单已被并发删 → 404', async () => {
    const order = await makeOrder()
    const { PartnerOrder } = TestDatabase.getSequelize().models

    vi.spyOn(PartnerOrder, 'update').mockResolvedValue([0])
    vi.spyOn(PartnerOrder, 'findOne').mockResolvedValue(null)

    const res = await request(app)
      .post(`/api/partner/orders/${order.id}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(404)
  })

  it('PC-6 affected=0 但并发确认已生效 → 幂等成功', async () => {
    const order = await makeOrder()
    const { PartnerOrder } = TestDatabase.getSequelize().models

    vi.spyOn(PartnerOrder, 'update').mockResolvedValue([0])
    const original = PartnerOrder.findOne.bind(PartnerOrder)
    vi.spyOn(PartnerOrder, 'findOne').mockImplementation(async (opts) => {
      const row = await original(opts)
      if (row && opts?.where?.id === order.id) {
        row.dataValues.online_paid_at = new Date()
      }
      return row
    })

    const res = await request(app)
      .post(`/api/partner/orders/${order.id}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(200)
  })

  it('PC-7 affected=0 且状态被改走 → 409', async () => {
    const order = await makeOrder()
    const { PartnerOrder } = TestDatabase.getSequelize().models

    vi.spyOn(PartnerOrder, 'update').mockResolvedValue([0])
    const original = PartnerOrder.findOne.bind(PartnerOrder)
    vi.spyOn(PartnerOrder, 'findOne').mockImplementation(async (opts) => {
      const row = await original(opts)
      if (row && opts?.where?.id === order.id) {
        row.dataValues.status = 'cancelled'
      }
      return row
    })

    const res = await request(app)
      .post(`/api/partner/orders/${order.id}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(409)
  })
})
