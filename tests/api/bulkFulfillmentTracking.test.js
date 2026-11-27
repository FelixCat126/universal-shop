/**
 * 批量发货：每单各自的物流单号（第 61 轮）
 * ==============================================
 *
 * ## 为什么要有这个
 *
 * **一个包裹一个单号**。批量发 5 单，快递系统回 5 个单号。
 * 原来的批量接口只能带**一个** `tracking_number` 整批覆盖 →
 * 只有两种坏结局：
 *
 *   ① 整批留空 → 客户收到的「已发货」通知里没有单号（查不到自己的包裹）
 *   ② 整批填同一个 → 5 单共用一个单号，客户查不到自己的包裹
 *
 * 所以批量要能**逐单**带单号。
 *
 * ## 关键设计：按 id 指定，不靠顺序
 *
 * `assignments: [{ id, tracking_number }]` —— **按 id 配对**。
 * 如果按"第 N 行对应第 N 单"的隐式顺序，运营粘贴时顺序错位就会**发错包裹**，
 * 而发错包裹的代价很高、事后极难查。
 *
 * ## 用例
 *
 *   BT-1 批量发货：每单拿到**自己**的物流单号
 *   BT-2 批次外的 id 被忽略（不能影响别的订单）
 *   BT-3 不带 assignments 时行为不变（整批一个单号 —— 兼容旧调用）
 *   BT-4 单号超长/含空格 → 按既有规则截断与去空格
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

const bulk = (token, body) =>
  request(app).post('/api/admin/orders/bulk/status').set('Authorization', `Bearer ${token}`).send(body)

/** 建一张处于"备货中"（可改发货）的订单 */
async function makeOrder (status = 'shipping') {
  const { Product, Order, OrderItem, User } = models()
  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  const product = await Product.create(TestDataFactory.createProduct({
    name: 'BT 商品', stock: 100, price: 100, status: 'active'
  }))
  const order = await Order.create({
    user_id: user.id,
    order_no: 'BT' + Date.now() + Math.floor(Math.random() * 1000),
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    total_amount: 100,
    total_amount_thb: 100,
    contact_name: 'BT',
    contact_phone: '13800138000',
    delivery_address: 'BT 地址',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    product_name_zh: 'BT 商品',
    quantity: 1,
    price: 100,
    line_total: 100
  })
  return order
}

describe('批量发货：逐单物流单号', () => {
  let token

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    token = TestHelpers.generateAdminToken(admin)
  })

  it('BT-1 每单拿到自己的物流单号', async () => {
    const a = await makeOrder()
    const b = await makeOrder()
    const c = await makeOrder()

    const res = await bulk(token, {
      ids: [a.id, b.id, c.id],
      status: 'shipped',
      assignments: [
        { id: a.id, tracking_number: 'SF-A' },
        { id: b.id, tracking_number: 'SF-B' },
        { id: c.id, tracking_number: 'SF-C' }
      ]
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const { Order } = models()
    const rows = await Order.findAll({ where: { id: [a.id, b.id, c.id] }, paranoid: false })
    const map = new Map(rows.map(o => [o.id, o.tracking_number]))
    expect(map.get(a.id), '第一单应是 SF-A').toBe('SF-A')
    expect(map.get(b.id), '第二单应是 SF-B').toBe('SF-B')
    expect(map.get(c.id), '第三单应是 SF-C').toBe('SF-C')
  })

  it('BT-2 批次外的 id 被忽略（不能影响别的订单）', async () => {
    const a = await makeOrder()
    const other = await makeOrder()

    const res = await bulk(token, {
      ids: [a.id],
      status: 'shipped',
      assignments: [
        { id: a.id, tracking_number: 'SF-A' },
        { id: other.id, tracking_number: 'SF-OTHER' }
      ]
    })
    expect(res.status).toBe(200)

    const { Order } = models()
    const untouched = await Order.findByPk(other.id, { paranoid: false })
    expect(untouched.status, '不在批次里的单不能被改').toBe('shipping')
    expect(untouched.tracking_number, '不在批次里的单不能被写单号').toBeNull()
  })

  it('BT-3 不带 assignments 时行为不变（整批一个单号）', async () => {
    const a = await makeOrder()
    const b = await makeOrder()

    const res = await bulk(token, { ids: [a.id, b.id], status: 'shipped', tracking_number: 'SF-SAME' })
    expect(res.status).toBe(200)

    const { Order } = models()
    const rows = await Order.findAll({ where: { id: [a.id, b.id] }, paranoid: false })
    rows.forEach(o => expect(o.tracking_number).toBe('SF-SAME'))
  })

  it('BT-4 单号去空格、超长截断（与单条路径同一口径）', async () => {
    const a = await makeOrder()
    const long = '  ' + 'X'.repeat(90) + '  '

    const res = await bulk(token, {
      ids: [a.id],
      status: 'shipped',
      assignments: [{ id: a.id, tracking_number: long }]
    })
    expect(res.status).toBe(200)

    const { Order } = models()
    const row = await Order.findByPk(a.id, { paranoid: false })
    expect(row.tracking_number.length, '单号应被截断到 64').toBe(64)
    expect(row.tracking_number, '首尾空格应被去掉').not.toMatch(/^\s|\s$/)
  })
})
