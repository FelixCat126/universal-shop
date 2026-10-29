/**
 * 订单状态机黑盒测试（10 用例）
 *
 * 用真实 HTTP 请求（管理端改状态接口）验证状态机：
 * - 合法跳转必须成功
 * - 非法跳转必须被拒（不能靠"接口没写判断"侥幸通过）
 * - 终态（completed / cancelled）不可再变更
 * - 非法跳转不得产生副作用（库存、积分、券不应被回补）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

async function makeAdminToken () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return TestHelpers.generateAdminToken(admin)
}

async function makeOrder (status = 'pending') {
  const { Order, OrderItem, Product, ProductCategory, User } = models()
  const user = await User.create({
    username: 'st-' + Date.now(), nickname: 'st', country_code: '+86',
    phone: '138' + String(Date.now()).slice(-8), password: 'StateTest1234',
    must_reset_password: false
  })
  const cat = await ProductCategory.create({ name: 'c-' + Date.now(), sort_order: 1 })
  const product = await Product.create({
    name: 'p', price: 100, stock: 50, category_id: cat.id, status: 'active'
  })
  const order = await Order.create({
    order_no: 'ST-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    total_amount: 100,
    total_amount_thb: 100,
    payment_method: 'cod',
    status,
    user_id: user.id
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 1,
    price: 100,
    original_price: 100,
    product_name_zh: product.name
  })
  return { order, product }
}

async function setStatus (token, orderId, status) {
  return request(app)
    .put(`/api/admin/orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status })
}

describe('Order.stateMachine', () => {
  let token

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    token = await makeAdminToken()
  })

  it('SM-1 pending → shipping 合法', async () => {
    const { order } = await makeOrder('pending')
    const res = await setStatus(token, order.id, 'shipping')
    expect(res.status).toBe(200)
    const { Order } = models()
    expect((await Order.findByPk(order.id)).status).toBe('shipping')
  })

  it('SM-2 pending → delivered 非法（跳步）', async () => {
    const { order } = await makeOrder('pending')
    const res = await setStatus(token, order.id, 'delivered')
    expect(res.status).toBe(400)
    const { Order } = models()
    expect((await Order.findByPk(order.id)).status).toBe('pending')
  })

  it('SM-3 pending → completed 非法', async () => {
    const { order } = await makeOrder('pending')
    const res = await setStatus(token, order.id, 'completed')
    expect(res.status).toBe(400)
  })

  it('SM-4 shipping → shipped 合法', async () => {
    const { order } = await makeOrder('shipping')
    const res = await setStatus(token, order.id, 'shipped')
    expect(res.status).toBe(200)
  })

  it('SM-5 shipping → paid 非法（回退）', async () => {
    const { order } = await makeOrder('shipping')
    const res = await setStatus(token, order.id, 'paid')
    expect(res.status).toBe(400)
  })

  it('SM-6 delivered → shipping 非法（回退）', async () => {
    const { order } = await makeOrder('delivered')
    const res = await setStatus(token, order.id, 'shipping')
    expect(res.status).toBe(400)
  })

  it('SM-7 completed 是终态，任何变更都非法', async () => {
    const { order } = await makeOrder('completed')
    for (const s of ['pending', 'shipping', 'cancelled', 'delivered']) {
      const res = await setStatus(token, order.id, s)
      expect(res.status, `completed → ${s} 应被拒`).toBe(400)
    }
  })

  it('SM-8 cancelled 是终态，任何变更都非法', async () => {
    const { order } = await makeOrder('cancelled')
    for (const s of ['pending', 'paid', 'shipping']) {
      const res = await setStatus(token, order.id, s)
      expect(res.status, `cancelled → ${s} 应被拒`).toBe(400)
    }
  })

  it('SM-9 非法跳转不得回补库存（无副作用）', async () => {
    const { order, product } = await makeOrder('pending')
    const before = product.stock
    const res = await setStatus(token, order.id, 'delivered')
    expect(res.status).toBe(400)
    const { Product } = models()
    // 非法跳转不应触发取消路径的资源回补
    expect((await Product.findByPk(product.id)).stock).toBe(before)
  })

  it('SM-10 合法取消会回补库存', async () => {
    const { order, product } = await makeOrder('pending')
    const before = product.stock
    const res = await setStatus(token, order.id, 'cancelled')
    expect(res.status).toBe(200)
    const { Product } = models()
    expect((await Product.findByPk(product.id)).stock).toBe(before + 1)
  })
})
