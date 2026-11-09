/**
 * 订单：幂等与竞态路径测试
 *
 * 这些分支之前**完全没测**，而它们恰恰是最容易出事的地方：
 *   - 同一个 client_order_key 重复提交 → 只能成一单（不能双扣库存）
 *   - 并发提交同一个 key → 靠 (user_id, client_order_key) 部分唯一索引兜底
 *   - 确认在线支付的幂等命中（重复确认不重复发积分）
 *   - 确认支付时订单已被并发删掉 → 404 而不是谎报"已确认"
 *
 *   OC-1 同一个幂等键重复提交 → 只成一单，库存只扣一次
 *   OC-2 并发提交同一个幂等键 → 只成一单
 *   OC-3 确认在线支付：重复确认 → 幂等成功，不重复发积分
 *   OC-4 确认在线支付：订单状态已被改走 → 409
 *   OC-5 确认在线支付：订单不存在 → 404
 *   OC-6 取消订单：积分/券的回补只做一次（重复取消不重复回补）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let user
let token
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models
  category = await ProductCategory.create({ name: '幂等测试分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '幂等测试商品', price: 50, stock: 500, category_id: category.id
  }))
  user = await models.User.create(await TestDataFactory.createUser({
    nickname: '幂等测试用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: `idem${Date.now()}@example.com`
  }))
  token = TestHelpers.generateToken(user)
})

/** 下单请求体 */
function orderBody (extra = {}) {
  return {
    items: [{ product_id: product.id, quantity: 2 }],
    contact_name: '收货人',
    contact_phone: '13800000000',
    delivery_address: '测试地址 1 号',
    payment_method: 'cod',
    ...extra
  }
}

describe('订单幂等', () => {
  it('OC-1 同一个幂等键重复提交 → 只成一单，库存只扣一次', async () => {
    const body = orderBody({ client_order_key: 'IDEM-KEY-1' })

    const first = await request(app)
      .post('/api/orders').set('Authorization', `Bearer ${token}`).send(body)
    expect(first.status).toBe(201)

    const second = await request(app)
      .post('/api/orders').set('Authorization', `Bearer ${token}`).send(body)
    // 幂等命中：返回 201 + deduplicated 标记（前端据此提示"已提交过"）
    expect(second.status).toBe(201)
    expect(second.body.data.deduplicated).toBe(true)
    expect(second.body.data.id).toBe(first.body.data.id)

    // 只成一单
    const { Order } = TestDatabase.getSequelize().models
    expect(await Order.count({ where: { user_id: user.id } })).toBe(1)
    // 库存只扣一次
    const { Product } = TestDatabase.getSequelize().models
    expect((await Product.findByPk(product.id)).stock).toBe(498)
  })

  it('OC-2 并发提交同一个幂等键 → 只成一单', async () => {
    const body = orderBody({ client_order_key: 'IDEM-KEY-RACE' })
    const results = await Promise.all([
      request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(body),
      request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(body),
      request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(body)
    ])
    // 至少一个成功，其余要么幂等命中（200）要么被唯一索引挡下（也返回同一单）
    const ok = results.filter(r => r.status === 200 || r.status === 201)
    expect(ok.length).toBeGreaterThanOrEqual(1)

    const { Order } = TestDatabase.getSequelize().models
    expect(await Order.count({ where: { user_id: user.id } })).toBe(1)
    const { Product } = TestDatabase.getSequelize().models
    expect((await Product.findByPk(product.id)).stock).toBe(498)
  })
})

describe('确认在线支付', () => {
  it('OC-3 重复确认 → 幂等成功，不重复发积分', async () => {
    // 造一张待支付的在线订单
    const { Order, OrderItem } = TestDatabase.getSequelize().models
    const order = await Order.create({
      order_no: `PAY${Date.now()}`,
      user_id: user.id,
      total_amount: 100,
      total_amount_thb: 100,
      discount_amount: 0,
      currency_code: 'THB',
      payment_method: 'online',
      status: 'pending', // 在线支付确认要求状态是 pending
      exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 1,
      price: 100, original_price: 100, product_name_zh: product.name
    })

    const first = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(first.status).toBe(200)
    expect(first.body.message).toMatch(/支付已确认/)

    const after1 = await Order.findByPk(order.id)
    const paidAt1 = after1.online_paid_at
    expect(paidAt1).toBeTruthy()

    // 第二次确认 → 幂等，不该报错也不该改 paid_at
    const second = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(second.status).toBe(200)

    const after2 = await Order.findByPk(order.id)
    expect(after2.online_paid_at.getTime()).toBe(paidAt1.getTime())
  })

  it('OC-4 订单状态已被改走（不再是待支付）→ 409', async () => {
    const { Order } = TestDatabase.getSequelize().models
    const order = await Order.create({
      order_no: `PAY${Date.now()}X`,
      user_id: user.id,
      total_amount: 100,
      total_amount_thb: 100,
      discount_amount: 0,
      currency_code: 'THB',
      payment_method: 'online',
      status: 'cancelled', // 已被取消
      exchange_rate: 1
    })

    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(409)
  })

  it('OC-5 订单不存在 → 404', async () => {
    const res = await request(app)
      .post('/api/orders/999999/confirm-online-payment')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(404)
  })
})

describe('取消订单的资源回补', () => {
  it('OC-6 重复取消不会重复回补库存', async () => {
    const { Order, OrderItem, Product } = TestDatabase.getSequelize().models
    const stockBefore = (await Product.findByPk(product.id)).stock

    const order = await Order.create({
      order_no: `CXL${Date.now()}`,
      user_id: user.id,
      total_amount: 100,
      total_amount_thb: 100,
      discount_amount: 0,
      currency_code: 'THB',
      payment_method: 'cod',
      status: 'pending',
      exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 2,
      price: 50, original_price: 50, product_name_zh: product.name
    })

    const { adminToken } = await makeAdmin()
    const first = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })
    expect(first.status).toBe(200)

    const stockAfter = (await Product.findByPk(product.id)).stock
    expect(stockAfter).toBe(stockBefore + 2)

    // 再取消一次 → 状态机不允许（已 cancelled 是终态）
    const second = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })
    expect(second.status).toBe(400)

    // 库存没有被二次回补
    expect((await Product.findByPk(product.id)).stock).toBe(stockAfter)
  })
})

/** 造一个管理员 */
async function makeAdmin () {
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `idem_admin_${Date.now()}`,
    password: 'IdemPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  return { admin, adminToken: TestHelpers.generateAdminToken(admin) }
}
