/**
 * 售后 / 软删 / 删除留痕 —— 第 1 轮抓到的真问题回归
 *
 *   AS-1 仅退款（refund）审批：**不回补库存**（客户没退货，货还在他手上）
 *   AS-2 退货（return）确认收货 → 正常回补库存
 *   AS-3 仅退款仍要收回购物积分与抵扣券（钱要退、券要还）
 *   AS-4 删除订单 → 连带清掉售后单（不留孤儿）
 *   AS-5 对已下架商品调整库存 → **真的生效**（之前静默无效却返回成功）
 *   AS-6 购物车里的商品被删后改数量 → 400 而不是 500
 *   AS-7 批量删商品 → 连带清购物车（与单条删除一致）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let user
let product

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `as_admin_${Date.now()}`,
    password: 'AsPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)

  const { User, Product } = models()
  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  product = await Product.create({
    name: '售后测试商品', price: 100, stock: 20, status: 'active'
  })
})

/** 造一笔订单（shipping 状态，扣了 3 件库存） */
async function mkOrder (status = 'shipping') {
  const { Order, OrderItem } = models()
  const order = await Order.create({
    order_no: `AS${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 300, total_amount_thb: 300,
    currency_code: 'THB', payment_method: 'cod',
    status,
    contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id, product_id: product.id, quantity: 3,
    price: 100, original_price: 100, product_name_zh: product.name
  })
  await product.update({ stock: 17 }) // 模拟下单扣了 3
  return order
}

/** 造一笔售后申请 */
async function mkAfterSale (order, type) {
  const { AfterSale } = models()
  return AfterSale.create({
    order_id: order.id,
    user_id: user.id,
    type,
    status: 'pending',
    reason: '测试',
    amount: 300
  })
}

describe('仅退款不应回补库存', () => {
  it('AS-1 仅退款审批 → 库存不变（货没退回）', async () => {
    const order = await mkOrder('shipping')
    const afterSale = await mkAfterSale(order, 'refund')

    const res = await request(app)
      .put(`/api/admin/after-sales/${afterSale.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })

    expect(res.status).toBe(200)

    const fresh = await models().Product.findByPk(product.id)
    expect(Number(fresh.stock), '⚠️ 仅退款不该回补库存：客户手里还拿着货').toBe(17)
  })

  it('AS-2 退货确认收货 → 正常回补库存', async () => {
    const order = await mkOrder('shipping')
    const afterSale = await mkAfterSale(order, 'return')

    // 先同意退货
    const approve = await request(app)
      .put(`/api/admin/after-sales/${afterSale.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })
    expect(approve.status).toBe(200)

    // 再确认收货 → 回补库存
    const received = await request(app)
      .put(`/api/admin/after-sales/${afterSale.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'received' })
    expect(received.status).toBe(200)

    const fresh = await models().Product.findByPk(product.id)
    expect(Number(fresh.stock), '退货入库应回补库存').toBe(20)
  })
})

describe('删除订单不留孤儿', () => {
  it('AS-4 删除订单 → 连带清掉售后单', async () => {
    const order = await mkOrder('shipping')
    const afterSale = await mkAfterSale(order, 'return')

    const res = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const { AfterSale, Order } = models()
    expect(await AfterSale.count({ where: { order_id: order.id } }), '售后单不应变成孤儿').toBe(0)
    expect(await Order.findByPk(order.id)).toBeFalsy()
  })
})

describe('已下架商品的写操作', () => {
  it('AS-5 对已下架商品调整库存 → 真的生效', async () => {
    // 软删商品
    await product.destroy()

    const res = await request(app)
      .post(`/api/products/${product.id}/stock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'set', quantity: 55 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const fresh = await models().Product.findByPk(product.id, { paranoid: false })
    expect(Number(fresh.stock), '⚠️ 之前这里静默无效却返回成功').toBe(55)
  })

  it('AS-6 购物车里的商品被删后改数量 → 400 而不是 500', async () => {
    const { Cart } = models()
    const cart = await Cart.create({
      user_id: user.id,
      session_id: null,
      product_id: product.id,
      quantity: 2,
      price: 100
    })

    // 商品被软删
    await product.destroy()

    const res = await request(app)
      .put(`/api/cart/${cart.id}`)
      .set('Authorization', `Bearer ${TestHelpers.generateToken(user)}`)
      .send({ quantity: 3 })

    expect(res.status, `不该 500：${JSON.stringify(res.body)}`).toBe(400)
    expect(res.body.message).toMatch(/下架|移除/)
  })

  it('AS-7 批量删商品 → 连带清购物车', async () => {
    const { Cart } = models()
    await Cart.create({
      user_id: user.id,
      session_id: null,
      product_id: product.id,
      quantity: 2,
      price: 100
    })

    const res = await request(app)
      .post('/api/products/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [product.id], action: 'delete' })

    expect(res.status).toBe(200)
    expect(await Cart.count({ where: { product_id: product.id } }), '批量删商品应清购物车').toBe(0)
  })
})
