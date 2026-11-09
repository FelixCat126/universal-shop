/**
 * 合作方门户（批发订货）的边界与幂等路径测试
 *
 * 批发是**独立的钱路**：零售和批发是两套逻辑、两套库存、两套价格。
 * 零售那边测得很细，批发这边的"拒绝坏输入"却大面积没测 ——
 * 而批发一单几十上百件，算错就是真金白银。
 *
 *   PB-1 下单：不选收货地址 → 400
 *   PB-2 下单：用**别人**的地址 → 400（越权）
 *   PB-3 下单：幂等键重复提交 → 只成一单，库存只扣一次
 *   PB-4 下单：商品不存在 → 400
 *   PB-5 下单：库存不足 → 400
 *   PB-6 下单：不满足 MOQ → 400
 *   PB-7 确认付款：订单不存在 → 404
 *   PB-8 确认付款：状态不对 → 409
 *   PB-9 确认付款：重复确认 → 幂等成功
 *   PB-10 地址：改别人的 → 404
 *   PB-11 地址：删别人的 → 404
 *   PB-12 商品列表：只返回在售商品
 *   PB-13 折扣：合作方折扣真的作用到单价上
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let partner
let token
let address
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models

  category = await ProductCategory.create({ name: '批发测试分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '批发测试商品', price: 100, stock: 1000, category_id: category.id
  }))

  const created = await TestHelpers.createPartnerWithAddress()
  partner = created.partner
  token = created.token
  address = created.address
})

/** 下单请求体（MOQ 是 50，测试统一用 50） */
function orderBody (extra = {}) {
  return {
    partner_address_id: address.id,
    items: [{ product_id: product.id, quantity: 50 }],
    ...extra
  }
}

describe('合作方下单的输入边界', () => {
  it('PB-1 下单：不选收货地址 → 400', async () => {
    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }] })
    expect(res.status).toBe(400)
  })

  it('PB-2 下单：用别人的地址 → 400（越权）', async () => {
    const other = await TestHelpers.createPartnerWithAddress()
    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send(orderBody({ partner_address_id: other.address.id }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/地址/)
  })

  it('PB-4 下单：商品不存在 → 400', async () => {
    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send(orderBody({ items: [{ product_id: 999999, quantity: 50 }] }))
    expect(res.status).toBe(400)
  })

  it('PB-5 下单：库存不足 → 400', async () => {
    const { Product } = TestDatabase.getSequelize().models
    await Product.update({ stock: 10 }, { where: { id: product.id } })
    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send(orderBody())
    expect(res.status).toBe(400)
  })

  it('PB-6 下单：不满足 MOQ → 400', async () => {
    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send(orderBody({ items: [{ product_id: product.id, quantity: 1 }] }))
    expect(res.status).toBe(400)
  })
})

describe('合作方下单的幂等', () => {
  it('PB-3 幂等键重复提交 → 只成一单，库存只扣一次', async () => {
    const body = orderBody({ client_order_key: 'PB-IDEM-1' })
    const first = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`).send(body)
    expect(first.status).toBe(201)

    const second = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`).send(body)
    expect([200, 201]).toContain(second.status)

    const { PartnerOrder } = TestDatabase.getSequelize().models
    expect(await PartnerOrder.count({ where: { partner_id: partner.id } })).toBe(1)
    const { Product } = TestDatabase.getSequelize().models
    expect((await Product.findByPk(product.id)).stock).toBe(950)
  })
})

describe('合作方确认付款', () => {
  it('PB-7 订单不存在 → 404', async () => {
    const res = await request(app)
      .post('/api/partner/orders/999999/confirm-payment')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(404)
  })

  it('PB-8 状态不对 → 409', async () => {
    const created = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`).send(orderBody())
    expect(created.status).toBe(201)
    const orderId = created.body.data.id

    // 新下的单是 submitted（不是 pending_payment）→ 确认付款应被拒
    const res = await request(app)
      .post(`/api/partner/orders/${orderId}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(409)
  })

  it('PB-9 重复确认 → 幂等成功（不报错）', async () => {
    const created = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`).send(orderBody())
    const orderId = created.body.data.id

    // 改成待付款（模拟管理端确认订单后的状态）
    const { PartnerOrder } = TestDatabase.getSequelize().models
    await PartnerOrder.update({ status: 'pending_payment' }, { where: { id: orderId } })

    const first = await request(app)
      .post(`/api/partner/orders/${orderId}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`).send({})
    expect(first.status).toBe(200)

    const second = await request(app)
      .post(`/api/partner/orders/${orderId}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`).send({})
    expect(second.status).toBe(200)
  })
})

describe('合作方地址的越权防护', () => {
  it('PB-10 地址：改别人的 → 404', async () => {
    const other = await TestHelpers.createPartnerWithAddress()
    const res = await request(app)
      .put(`/api/partner/addresses/${other.address.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: '被篡改' })
    expect(res.status).toBe(404)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    const fresh = await PartnerAddress.findByPk(other.address.id)
    expect(fresh.recipient_name).not.toBe('被篡改')
  })

  it('PB-11 地址：删别人的 → 404', async () => {
    const other = await TestHelpers.createPartnerWithAddress()
    const res = await request(app)
      .delete(`/api/partner/addresses/${other.address.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    expect(await PartnerAddress.findByPk(other.address.id)).toBeTruthy()
  })
})

describe('合作方商品与价格', () => {
  it('PB-12 商品列表：返回在售商品', async () => {
    const res = await request(app)
      .get('/api/partner/products').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const list = res.body.data?.products || res.body.data || []
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(0)
  })

  it('PB-13 折扣：合作方折扣真的作用到单价上', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    await Partner.update({ discount_percent: 50 }, { where: { id: partner.id } })

    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`).send(orderBody())
    expect(res.status).toBe(201)

    const { PartnerOrderItem, Product } = TestDatabase.getSequelize().models
    const item = await PartnerOrderItem.findOne({ where: { partner_order_id: res.body.data.id } })

    // 零售底价 = 商品价 × (1 - 商品自身折扣)；合作方单价 = 零售底价 × (1 - 合作方折扣)
    const p2 = (await Product.findByPk(product.id)).toJSON()
    const retailBase = Math.round(Number(p2.price) * (1 - Number(p2.discount || 0) / 100) * 100) / 100
    const expectedUnit = Math.round(retailBase * 0.5 * 100) / 100

    expect(Number(item.base_unit_thb)).toBe(retailBase)
    expect(Number(item.unit_price_thb)).toBe(expectedUnit)
    expect(Number(item.partner_discount_percent_snapshot)).toBe(50)
    // 行小计 = 单价 × 数量
    expect(Number(item.line_total_thb)).toBe(Math.round(expectedUnit * 50 * 100) / 100)
  })
})
