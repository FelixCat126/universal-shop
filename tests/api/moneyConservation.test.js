/**
 * 金额守恒：订单总额必须**等于**各行应付之和
 *
 * ## 为什么守恒比"不多收钱"更严
 *
 * 现有体检项 `order_total_not_exceeding_items` 只查
 * 「订单总额 ≤ 明细原价之和」—— 那只能抓"多收了钱"。
 *
 * 真正该成立的是**恒等式**：
 *
 *     orders.total_amount_thb == Σ(order_items.line_total - order_items.discount_allocated)
 *                                （赠品行不参与）
 *
 * 因为：
 *   - `line_total` 是该行的权威小计（THB 域，组合包按权重分摊时 price×quantity ≠ line_total）
 *   - `discount_allocated` 是摊到该行的优惠额（满减 + 券）
 *   - 两者相减 = 该行实付；全部相加 = 客户实际付的钱
 *
 * 恒等式不成立意味着：**订单页显示的行金额加起来 ≠ 订单总额**，
 * 也就是客户看到的账单对不上、或者商家与客户算出来的钱不一样。
 * 这类问题在生产里只会以"客户说金额不对"的形式出现。
 *
 * ## 为什么必须覆盖组合
 *
 * 单个场景测不出分摊的尾差问题：
 *   - 券在多行之间按比例分摊 → 逐行 round2 会产生尾差，尾差归到某一行
 *   - 组合包按权重分摊组合价 → 权重除不尽时同样有尾差
 *   - 买多赠一 → 赠品行 price=0 但要回补库存，且不参与金额
 *   - 满减 + 券叠加 → 两层分摊叠加
 * 所以这里用**组合矩阵**逐个验，而不是只验一个"有券的订单"。
 *
 *   MC-1 无优惠
 *   MC-2 商品折扣（单品 discount）
 *   MC-3 满减促销
 *   MC-4 抵扣券
 *   MC-5 满减 + 券叠加
 *   MC-6 组合包（权重除不尽）+ 券
 *   MC-7 买多赠一（赠品行不参与金额）
 *   MC-8 组合包 + 满减 + 券（最复杂组合）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
})

const ORDER_BODY = {
  contact_name: '守恒测试',
  contact_phone: '13800000002',
  delivery_address: 'A',
  province: '北京市',
  city: '北京市',
  district: '朝阳区',
  postal_code: '100000'
}

async function userWithToken () {
  const { User } = models()
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  return { user: u, token: TestHelpers.generateToken(u) }
}

/** 下单并返回落库后的订单 + 明细 */
async function placeOrder (items, extra = {}) {
  const { token } = await userWithToken()
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...ORDER_BODY, items, payment_method: 'cod', ...extra })
  expect(res.status, `下单失败：${JSON.stringify(res.body)}`).toBe(201)
  const { Order, OrderItem } = models()
  const order = await Order.findByPk(res.body.data.order.id)
  const lines = await OrderItem.findAll({ where: { order_id: order.id }, order: [['id', 'ASC']] })
  return { order, lines, token }
}

/**
 * 核心断言：订单总额（THB 域）必须等于各行应付之和。
 * 赠品行（is_gift=true）不参与金额 —— 它的 price=0，本就不该计入。
 */
function expectConservation (order, lines, label) {
  const payableSum = lines
    .filter(l => !l.is_gift)
    .reduce((s, l) => s + Number(l.line_total || 0) - Number(l.discount_allocated || 0), 0)
  const total = Number(order.total_amount_thb || 0)
  const diff = Math.abs(total - payableSum)
  expect(
    diff < 0.01,
    `${label}：订单总额 ${total} ≠ 各行应付之和 ${payableSum.toFixed(2)}（差 ${diff.toFixed(2)}）\n` +
    lines.map(l => `  行 ${l.id}: line_total=${l.line_total} discount_allocated=${l.discount_allocated} gift=${l.is_gift}`).join('\n')
  ).toBe(true)
}

async function product (overrides = {}) {
  const { Product } = models()
  return Product.create(
    TestDataFactory.createProduct({ stock: 100, status: 'active', price: 100, ...overrides })
  )
}

describe('金额守恒：订单总额 == 各行应付之和', () => {
  it('MC-1 无优惠', async () => {
    const p = await product()
    const { order, lines } = await placeOrder([{ product_id: p.id, quantity: 3 }])
    expectConservation(order, lines, 'MC-1 无优惠')
  })

  it('MC-2 商品折扣', async () => {
    const p = await product({ discount: 20 })
    const { order, lines } = await placeOrder([{ product_id: p.id, quantity: 2 }])
    // 商品直降体现在**行价**上（line_total 已含直降），不计入 discount_amount
    // （discount_amount 只统计满减与券）。所以这里断言行价确实降了。
    expect(Number(lines[0].original_price), 'original_price 应是原价').toBe(100)
    expect(Number(lines[0].line_total), '行小计应已含单品直降').toBeLessThan(200)
    expectConservation(order, lines, 'MC-2 商品折扣')
  })

  it('MC-3 满减促销', async () => {
    const { Promotion } = models()
    await Promotion.create({
      name: '守恒满减',
      type: 'threshold',
      rules: { tiers: [{ min: 100, off: 30 }] },
      scope: { type: 'all', ids: [] },
      priority: 0,
      status: 'active'
    })
    const p = await product()
    const { order, lines } = await placeOrder([{ product_id: p.id, quantity: 2 }])
    expect(Number(order.discount_amount)).toBeGreaterThan(0)
    expectConservation(order, lines, 'MC-3 满减促销')
  })

  it('MC-4 抵扣券', async () => {
    const { token } = await userWithToken()
    const { CouponTemplate, UserCoupon } = models()
    const tpl = await CouponTemplate.create({
      name: '守恒券', type: 'discount', amount: 50, min_spend: 100,
      status: 'active', scope: { type: 'all', ids: [] }
    })
    const { User } = models()
    const user = await User.findOne({ order: [['id', 'ASC']] })
    const coupon = await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: `MC${Date.now().toString(36)}`
    })
    const p = await product()
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ product_id: p.id, quantity: 2 }],
        payment_method: 'cod',
        user_coupon_id: coupon.id
      })
    expect(res.status, `下单失败：${JSON.stringify(res.body)}`).toBe(201)
    const { Order, OrderItem } = models()
    const order = await Order.findByPk(res.body.data.order.id)
    const lines = await OrderItem.findAll({ where: { order_id: order.id } })
    expect(Number(order.discount_amount)).toBeGreaterThan(0)
    expectConservation(order, lines, 'MC-4 抵扣券')
  })

  it('MC-5 满减 + 券叠加', async () => {
    const { token } = await userWithToken()
    const { Promotion, CouponTemplate, UserCoupon, User } = models()
    await Promotion.create({
      name: '叠加满减',
      type: 'threshold',
      rules: { tiers: [{ min: 100, off: 30 }] },
      scope: { type: 'all', ids: [] },
      priority: 0,
      status: 'active'
    })
    const tpl = await CouponTemplate.create({
      name: '叠加券', type: 'discount', amount: 25, min_spend: 50,
      status: 'active', scope: { type: 'all', ids: [] }
    })
    const user = await User.findOne({ order: [['id', 'ASC']] })
    const coupon = await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: `MC5${Date.now().toString(36)}`
    })
    // 两个商品行 → 券要按行分摊，尾差才暴露
    const p1 = await product({ price: 99 })
    const p2 = await product({ price: 77 })
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ product_id: p1.id, quantity: 1 }, { product_id: p2.id, quantity: 3 }],
        payment_method: 'cod',
        user_coupon_id: coupon.id
      })
    expect(res.status, `下单失败：${JSON.stringify(res.body)}`).toBe(201)
    const { Order, OrderItem } = models()
    const order = await Order.findByPk(res.body.data.order.id)
    const lines = await OrderItem.findAll({ where: { order_id: order.id } })
    expect(Number(order.discount_amount)).toBeGreaterThan(0)
    expectConservation(order, lines, 'MC-5 满减 + 券叠加')
  })

  it('MC-6 组合包（权重除不尽）+ 券', async () => {
    const { token } = await userWithToken()
    const { Bundle, BundleItem, CouponTemplate, UserCoupon, User, Product } = models()
    const compA = await Product.create({ name: '组件A', price: 33, stock: 100, status: 'active' })
    const compB = await Product.create({ name: '组件B', price: 67, stock: 100, status: 'active' })
    const bundle = await Bundle.create({
      name: '守恒组合包', price: 99, status: 'active', description: 'x', image: null
    })
    await BundleItem.create({ bundle_id: bundle.id, product_id: compA.id, quantity: 1, sort_order: 0 })
    await BundleItem.create({ bundle_id: bundle.id, product_id: compB.id, quantity: 2, sort_order: 1 })
    const tpl = await CouponTemplate.create({
      name: '组合券', type: 'discount', amount: 7, min_spend: 50,
      status: 'active', scope: { type: 'all', ids: [] }
    })
    const user = await User.findOne({ order: [['id', 'ASC']] })
    const coupon = await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: `MC6${Date.now().toString(36)}`
    })
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ bundle_id: bundle.id, quantity: 1 }],
        payment_method: 'cod',
        user_coupon_id: coupon.id
      })
    expect(res.status, `下单失败：${JSON.stringify(res.body)}`).toBe(201)
    const { Order, OrderItem } = models()
    const order = await Order.findByPk(res.body.data.order.id)
    const lines = await OrderItem.findAll({ where: { order_id: order.id } })
    expectConservation(order, lines, 'MC-6 组合包 + 券')
  })

  it('MC-7 买多赠一（赠品行不参与金额）', async () => {
    const { Promotion } = models()
    await Promotion.create({
      name: '买三赠一',
      type: 'buy_x_get_y',
      rules: { buy_quantity: 3, get_quantity: 1, scope_type: 'product' },
      scope: { type: 'all', ids: [] },
      priority: 0,
      status: 'active'
    })
    const p = await product()
    const { order, lines } = await placeOrder([{ product_id: p.id, quantity: 3 }])
    const gifts = lines.filter(l => l.is_gift)
    if (gifts.length) {
      for (const g of gifts) {
        expect(Number(g.price)).toBe(0)
        expect(Number(g.line_total)).toBe(0)
      }
    }
    expectConservation(order, lines, 'MC-7 买多赠一')
  })

  it('MC-9 积分兑换单：实收记 0，不会被守恒检查误报', async () => {
    const { token } = await userWithToken()
    const { Product, User, UserPointBalance, PointTransaction, Order, OrderItem } = models()
    const p = await Product.create({
      name: '积分商品', price: 100, stock: 100, status: 'active', points: 10
    })
    const user = await User.findOne({ order: [['id', 'ASC']] })
    // 给用户备足积分
    await UserPointBalance.create({ user_id: user.id, balance: 1000, after_balance: 1000 })
    await PointTransaction.create({
      user_id: user.id, type: 'earn_other', delta: 1000, balance_after: 1000,
      description: '测试备积分'
    })
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ product_id: p.id, quantity: 2 }],
        payment_method: 'points'
      })
    expect(res.status, `积分下单失败：${JSON.stringify(res.body)}`).toBe(201)
    const order = await Order.findByPk(res.body.data.order.id)
    const lines = await OrderItem.findAll({ where: { order_id: order.id } })
    // 积分单用积分付钱 → 实收金额记 0（行里是 THB 参考价，两者本就不相等）
    expect(Number(order.total_amount_thb), '积分单实收应为 0').toBe(0)

    // 关键：体检项不能把积分单判成"少收了钱"
    const { CHECKS } = await import('@server/utils/dataInvariants.js')
    const check = CHECKS.find(c => c.name === 'order_total_equals_lines_payable')
    const { QueryTypes } = await import('sequelize')
    const rows = await TestDatabase.getSequelize().query(check.sql, { type: QueryTypes.SELECT })
    expect(rows.length, '积分兑换单被守恒检查误报了（实收 0 vs 行 THB 参考价）').toBe(0)
  })

  it('MC-8 组合包 + 满减 + 券（最复杂组合）', async () => {
    const { token } = await userWithToken()
    const { Bundle, BundleItem, Promotion, CouponTemplate, UserCoupon, User, Product } = models()
    const compA = await Product.create({ name: '组合件A', price: 41, stock: 100, status: 'active' })
    const compB = await Product.create({ name: '组合件B', price: 59, stock: 100, status: 'active' })
    const bundle = await Bundle.create({
      name: '复杂组合包', price: 97, status: 'active', description: 'x', image: null
    })
    await BundleItem.create({ bundle_id: bundle.id, product_id: compA.id, quantity: 1, sort_order: 0 })
    await BundleItem.create({ bundle_id: bundle.id, product_id: compB.id, quantity: 3, sort_order: 1 })
    await Promotion.create({
      name: '复杂满减',
      type: 'threshold',
      rules: { tiers: [{ min: 50, off: 11 }] },
      scope: { type: 'all', ids: [] },
      priority: 0,
      status: 'active'
    })
    const tpl = await CouponTemplate.create({
      name: '复杂券', type: 'discount', amount: 13, min_spend: 30,
      status: 'active', scope: { type: 'all', ids: [] }
    })
    const user = await User.findOne({ order: [['id', 'ASC']] })
    const coupon = await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: `MC8${Date.now().toString(36)}`
    })
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ bundle_id: bundle.id, quantity: 2 }],
        payment_method: 'cod',
        user_coupon_id: coupon.id
      })
    expect(res.status, `下单失败：${JSON.stringify(res.body)}`).toBe(201)
    const { Order, OrderItem } = models()
    const order = await Order.findByPk(res.body.data.order.id)
    const lines = await OrderItem.findAll({ where: { order_id: order.id } })
    expectConservation(order, lines, 'MC-8 组合包 + 满减 + 券')
  })
})
