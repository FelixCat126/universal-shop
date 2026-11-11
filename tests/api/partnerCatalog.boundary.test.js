/**
 * 合作方门户：商品目录的筛选/搜索 + 订单列表
 *
 * 这些是合作方**每天都在用**的操作，之前一个都没测：
 *   - 按分类挑货
 *   - 按名称搜货
 *   - 按 ids 批量取（"再来一单"要按当前价与库存回查商品）
 *   - 订单列表按状态筛
 *
 *   PC-1 商品列表：按分类筛选
 *   PC-2 商品列表：按名称搜索（name / alias 都匹配）
 *   PC-3 商品列表：按 ids 批量取（再来一单）
 *   PC-4 商品列表：只返回在售商品（下架的不给）
 *   PC-5 商品列表：库存字段是数字（前端据此限制数量上限，缺失会导致可填超库存）
 *   PC-6 商品列表：数据库失败 → 500
 *   PC-7 下单：client_order_key 超长 → 400
 *   PC-8 订单列表：按状态筛选
 *   PC-9 订单列表：返回带商品行的订单
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { injectFault, restoreFaults } from '../helpers/faultInjection.js'

let partner
let token
let categoryA
let categoryB
let productA
let productB
let delisted

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product, ProductCategory } = models

  categoryA = await ProductCategory.create({ name: '电子烟' })
  categoryB = await ProductCategory.create({ name: '配件' })

  productA = await Product.create({
    name: '薄荷雾化弹', alias: 'mint', price: 100, discount: 0, stock: 500,
    category_id: categoryA.id, status: 'active'
  })
  productB = await Product.create({
    name: '充电线', alias: 'type-c', price: 50, discount: 10, stock: 30,
    category_id: categoryB.id, status: 'active'
  })
  delisted = await Product.create({
    name: '已下架商品', price: 10, stock: 5, category_id: categoryA.id, status: 'inactive'
  })

  const created = await TestHelpers.createPartnerWithAddress()
  partner = created.partner
  token = created.token
})

afterEach(() => {
  restoreFaults()
})

const listProducts = (query = '') =>
  request(app).get(`/api/partner/products${query}`).set('Authorization', `Bearer ${token}`)

describe('合作方商品目录', () => {
  it('PC-1 按分类筛选', async () => {
    const res = await listProducts(`?category_id=${categoryA.id}`)
    expect(res.status).toBe(200)
    const ids = res.body.data.products.map(p => p.id)
    expect(ids).toContain(productA.id)
    expect(ids).not.toContain(productB.id)
  })

  it('PC-2 按名称搜索（name / alias 都匹配）', async () => {
    const byName = await request(app).get('/api/partner/products')
      .query({ name: '薄荷' }).set('Authorization', `Bearer ${token}`)
    expect(byName.body.data.products.map(p => p.id)).toContain(productA.id)

    const byAlias = await request(app).get('/api/partner/products')
      .query({ name: 'type-c' }).set('Authorization', `Bearer ${token}`)
    expect(byAlias.body.data.products.map(p => p.id)).toContain(productB.id)
  })

  it('PC-3 按 ids 批量取（再来一单要按当前价回查）', async () => {
    const res = await listProducts(`?ids=${productA.id},${productB.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(2)
    for (const p of res.body.data.products) {
      // 必须带当前单价与库存（再来一单按这个价算）
      expect(p.unit_price_thb).toBeGreaterThan(0)
      expect(p.stock).toBeGreaterThanOrEqual(0)
    }
  })

  it('PC-4 只返回在售商品', async () => {
    const res = await listProducts()
    const ids = res.body.data.products.map(p => p.id)
    expect(ids).not.toContain(delisted.id)
    expect(ids).toContain(productA.id)
  })

  it('PC-5 库存字段是数字（缺失会让前端的上限失效）', async () => {
    const res = await listProducts()
    for (const p of res.body.data.products) {
      expect(typeof p.stock, 'stock 必须是数字').toBe('number')
      expect(Number.isNaN(p.stock)).toBe(false)
    }
  })

  it('PC-6 数据库失败 → 500', async () => {
    const { Product } = TestDatabase.getSequelize().models
    injectFault(Product, 'findAndCountAll', new Error('db down'))
    const res = await listProducts()
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })

  it('PC-7 下单：client_order_key 超长 → 400', async () => {
    const { PartnerAddress } = TestDatabase.getSequelize().models
    const addr = await PartnerAddress.findOne({ where: { partner_id: partner.id } })
    const res = await request(app)
      .post('/api/partner/orders').set('Authorization', `Bearer ${token}`)
      .send({
        partner_address_id: addr.id,
        client_order_key: 'x'.repeat(65),
        items: [{ product_id: productA.id, quantity: 50 }]
      })
    expect(res.status).toBe(400)
  })

  it('PC-8 订单列表：按状态筛选', async () => {
    const { PartnerOrder, PartnerOrderItem } = TestDatabase.getSequelize().models
    const mk = async (status) => {
      const o = await PartnerOrder.create({
        partner_id: partner.id,
        partner_address_id: null,
        order_no: `PL${Date.now()}${Math.floor(Math.random() * 1000)}`,
        status,
        total_amount: 100, total_amount_thb: 100,
        currency_code: 'THB', payment_method: 'cod'
      })
      await PartnerOrderItem.create({
        partner_order_id: o.id, product_id: productA.id, quantity: 50,
        base_unit_thb: 100, unit_price_thb: 100, line_total_thb: 5000,
        partner_discount_percent_snapshot: 0, product_name_snapshot: productA.name
      })
      return o
    }
    await mk('submitted')
    await mk('processing')

    const all = await request(app).get('/api/partner/orders').set('Authorization', `Bearer ${token}`)
    expect(all.status).toBe(200)
    expect(all.body.data.orders.length).toBe(2)

    const done = await request(app).get('/api/partner/orders')
      .query({ status: 'processing' }).set('Authorization', `Bearer ${token}`)
    expect(done.status).toBe(200)
    expect(done.body.data.orders.length).toBe(1)
    expect(done.body.data.orders[0].status).toBe('processing')

    // 非法状态 → 400（别静默忽略，那样用户以为筛了其实没筛）
    const bad = await request(app).get('/api/partner/orders')
      .query({ status: 'not_a_status' }).set('Authorization', `Bearer ${token}`)
    expect(bad.status).toBe(400)
  })

  it('PC-9 订单列表：返回带商品行的订单', async () => {
    const { PartnerOrder, PartnerOrderItem } = TestDatabase.getSequelize().models
    const o = await PartnerOrder.create({
      partner_id: partner.id,
      partner_address_id: null,
      order_no: `PL${Date.now()}`,
      status: 'submitted',
      total_amount: 100, total_amount_thb: 100,
      currency_code: 'THB', payment_method: 'cod'
    })
    await PartnerOrderItem.create({
      partner_order_id: o.id, product_id: productA.id, quantity: 50,
      base_unit_thb: 100, unit_price_thb: 100, line_total_thb: 5000,
      partner_discount_percent_snapshot: 0, product_name_snapshot: productA.name
    })

    const res = await request(app).get('/api/partner/orders').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const order = res.body.data.orders[0]
    expect(order).toBeTruthy()
    expect(Array.isArray(order.items)).toBe(true)
    expect(order.items.length).toBe(1)
    expect(order.items[0].quantity).toBe(50)
  })
})
