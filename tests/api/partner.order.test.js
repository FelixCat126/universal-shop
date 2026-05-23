/**
 * P2 合作方 — 下单 + MOQ 边界 + 折扣快照（14 用例）
 *
 *   happy 2：
 *     PO-1  dealer 单产品 happy → 201 + status='submitted'
 *     PO-2  dealer 多产品 happy → 201
 *
 *   MOQ 4（unit=50/multiplier=3 时数量 50/51/52/53 行为）：
 *     PO-3  qty=50 → 201（恰好 MOQ）
 *     PO-4  qty=51 → 400（不是步进）
 *     PO-5  qty=52 → 400
 *     PO-6  qty=53 → 201（50 + 3）
 *
 *   配置异常 3（unit=0/-1/abc 应回退 50）：
 *     PO-7  moq_unit=0 时 qty=50 应通过（回退到 50）
 *     PO-8  moq_unit=-1 时 qty=50 应通过
 *     PO-9  moq_unit=abc 时 qty=50 应通过
 *
 *   折扣快照 3（discount_percent=0/50/100）：
 *     PO-10 dp=0 → 单价 = 商品 price，line_total 同
 *     PO-11 dp=50 → 单价 = 商品 price * 0.5
 *     PO-12 dp=100 → 单价 = 0
 *
 *   状态默认 + 多单 2：
 *     PO-13 dealer 默认 status='submitted'
 *     PO-14 同时下两单成功且 order_no 各自唯一
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

async function partnerOrderingCtx ({ discount_percent = 10, moq = {}, productPrice = 100 } = {}) {
  await seedSystemConfigBaseline(moq)
  const { partner, address, token } = await TestHelpers.createPartnerWithAddress({
    discount_percent
  })
  const sequelize = TestDatabase.getSequelize()
  const { Product } = sequelize.models
  // discount: null 避免商品级折扣干扰合作方折扣快照断言
  const product = await Product.create(
    TestDataFactory.createProduct({ price: productPrice, discount: null, stock: 10000, status: 'active' })
  )
  return { partner, address, token, product }
}

function postOrder (token, body) {
  return request(app).post('/api/partner/orders')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
}

describe('P2.partner.order — happy', () => {
  it('PO-1 dealer 单产品 happy → 201 submitted', async () => {
    const { token, address, product } = await partnerOrderingCtx()
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('submitted')
  })

  it('PO-2 dealer 多产品 happy', async () => {
    await seedSystemConfigBaseline()
    const { partner, address, token } = await TestHelpers.createPartnerWithAddress({
      discount_percent: 10
    })
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p1 = await Product.create(TestDataFactory.createProduct({ price: 100, discount: null, stock: 1000, status: 'active' }))
    const p2 = await Product.create(TestDataFactory.createProduct({ price: 200, discount: null, stock: 1000, status: 'active' }))

    const res = await postOrder(token, {
      items: [
        { product_id: p1.id, quantity: 50 },
        { product_id: p2.id, quantity: 100 }
      ],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
    expect(res.body.data.items.length).toBe(2)
  })
})

describe('P2.partner.order — MOQ 边界 unit=50 multiplier=3', () => {
  it('PO-3 qty=50 → 201', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: 50, partner_order_moq_multiplier: 3 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
  })

  it('PO-4 qty=51 → 400 不是步进', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: 50, partner_order_moq_multiplier: 3 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 51 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/数量须从|起|倍数/)
  })

  it('PO-5 qty=52 → 400', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: 50, partner_order_moq_multiplier: 3 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 52 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(400)
  })

  it('PO-6 qty=53 (50+3) → 201', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: 50, partner_order_moq_multiplier: 3 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 53 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
  })
})

describe('P2.partner.order — MOQ 配置异常回退', () => {
  it('PO-7 moq_unit=0 → 回退 50；qty=50 应通过', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: 0, partner_order_moq_multiplier: 1 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
  })

  it('PO-8 moq_unit=-1 → 回退；qty=50 应通过', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: -1, partner_order_moq_multiplier: 1 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
  })

  it('PO-9 moq_unit="abc" → 回退；qty=50 应通过', async () => {
    const { token, address, product } = await partnerOrderingCtx({
      moq: { partner_order_moq_unit: 'abc', partner_order_moq_multiplier: 1 }
    })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
  })
})

describe('P2.partner.order — 折扣快照', () => {
  it('PO-10 discount_percent=0 → 单价等于商品 price', async () => {
    const { token, address, product } = await partnerOrderingCtx({ discount_percent: 0, productPrice: 200 })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
    expect(parseFloat(res.body.data.items[0].unit_price_thb)).toBe(200)
    expect(parseFloat(res.body.data.items[0].partner_discount_percent_snapshot)).toBe(0)
  })

  it('PO-11 dp=50 → 单价是 price 一半', async () => {
    const { token, address, product } = await partnerOrderingCtx({ discount_percent: 50, productPrice: 200 })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
    expect(parseFloat(res.body.data.items[0].unit_price_thb)).toBe(100)
  })

  it('PO-12 dp=100 → 单价 0', async () => {
    const { token, address, product } = await partnerOrderingCtx({ discount_percent: 100, productPrice: 200 })
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
    expect(parseFloat(res.body.data.items[0].unit_price_thb)).toBe(0)
    expect(parseFloat(res.body.data.total_amount_thb)).toBe(0)
  })
})

describe('P2.partner.order — 状态/多单', () => {
  it('PO-13 dealer 默认 status="submitted"', async () => {
    const { token, address, product } = await partnerOrderingCtx()
    const res = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('submitted')
  })

  it('PO-14 同时下两单 order_no 各自唯一', async () => {
    const { token, address, product } = await partnerOrderingCtx()
    const r1 = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    const r2 = await postOrder(token, {
      items: [{ product_id: product.id, quantity: 50 }],
      partner_address_id: address.id
    })
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    expect(r1.body.data.order_no).not.toBe(r2.body.data.order_no)
  })
})
