/**
 * 批量取消的**资源回补正确性 + 查询条数**护栏
 *
 * ## 为什么专门写这个
 *
 * 批量取消是运营最常用的批量动作，而它一次要处理 N 张单、涉及
 * **库存回补 / 积分收回 / 券释放** 三样钱相关的东西。
 * 为了性能把它改成"批量预取 + 共享余额行实例"之后，
 * **最容易出的错就是"多回补一次"或"少回补一次"** —— 库存虚增 / 积分对不上。
 *
 * 所以这里不只验"能改成"，而是逐项验**恰好一次**，外加**查询条数不失控**。
 *
 *   BC-1 批量取消 N 单：库存**恰好**回补 N 件（不多不少）
 *   BC-2 批量取消 N 单：积分**恰好**收回 N 笔（余额与流水都对得上）
 *   BC-3 批量取消 N 单：抵扣券退回未使用
 *   BC-4 积分已被花掉的那单被跳过，其余照常回补（不能因为一张单卡住整批）
 *   BC-5 查询条数不随订单数线性膨胀（批量预取的收益不许被回潮吃掉）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { sequelize } from '@server/models/index.js'

const models = () => TestDatabase.getSequelize().models

let token
let user
let product
let couponTemplate

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)

  const { User, Product, CouponTemplate } = models()
  user = await User.create({
    username: 'bc_' + Date.now(), nickname: '批量用户', country_code: '+86',
    phone: '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
    password: 'Abcd1234', is_active: true
  })
  product = await Product.create({ name: '批量商品', price: 100, stock: 0, status: 'active' })
  couponTemplate = await CouponTemplate.create({
    name: '批量券', type: 'discount', amount: 50, min_spend: 100,
    status: 'active', scope: { type: 'all', ids: [] }
  })
})

/**
 * 建 N 张 pending 单（同一用户、同一商品、带明细与购物积分流水）
 * @returns {Promise<number[]>} 订单 id 数组
 */
async function makeOrders (n, { eachEarn = 10, withCoupon = false } = {}) {
  const { Order, OrderItem, PointTransaction, UserPointBalance, UserCoupon } = models()
  const ids = []
  for (let i = 0; i < n; i++) {
    const order = await Order.create({
      order_no: `BC${Date.now()}${i}${Math.floor(Math.random() * 100)}`,
      user_id: user.id,
      total_amount: 100,
      total_amount_thb: 100,
      currency_code: 'THB',
      payment_method: 'cod',
      status: 'pending',
      contact_name: '批量',
      contact_phone: '13800138000',
      delivery_address: 'A',
      exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 1,
      price: 100, original_price: 100, product_name_zh: product.name, line_total: 100
    })
    if (eachEarn > 0) {
      await PointTransaction.create({
        user_id: user.id, order_id: order.id, type: 'earn_purchase',
        delta: eachEarn, balance_after: eachEarn * (i + 1), description: '购物积分'
      })
    }
    if (withCoupon) {
      await UserCoupon.create({
        template_id: couponTemplate.id, user_id: user.id,
        code: `BC${Date.now()}${i}`,
        status: 'used', used_by_order_id: order.id, used_at: new Date()
      })
    }
    ids.push(order.id)
  }
  if (n > 0) {
    await UserPointBalance.create({
      user_id: user.id, balance: eachEarn * n, after_balance: eachEarn * n
    })
  }
  return ids
}

async function bulkCancel (ids) {
  const res = await request(app).post('/api/admin/orders/bulk/status')
    .set('Authorization', `Bearer ${token}`)
    .send({ ids, status: 'cancelled' })
  expect(res.status).toBe(200)
  return res.body
}

describe('批量取消：资源恰好回补一次', () => {
  it('BC-1 库存恰好回补 N 件', async () => {
    const ids = await makeOrders(4, { eachEarn: 0 })
    const body = await bulkCancel(ids)
    expect(body.data.changed.length).toBe(4)

    const after = await models().Product.findByPk(product.id, { raw: true })
    expect(Number(after.stock), '库存必须恰好回补 4 件（不多回补 → 库存虚增）').toBe(4)
  })

  it('BC-2 积分恰好收回 N 笔，余额与流水对得上', async () => {
    const ids = await makeOrders(4, { eachEarn: 10 })
    const body = await bulkCancel(ids)
    expect(body.data.changed.length).toBe(4)

    const { UserPointBalance, PointTransaction } = models()
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id }, raw: true })
    expect(Number(bal.balance), '余额必须恰好收回 40 分').toBe(0)

    const revokes = await PointTransaction.findAll({
      where: { user_id: user.id, type: 'revoke_cancel' }
    })
    expect(revokes.length, '每单一条收回流水（不多不少）').toBe(4)
    const revokedSum = revokes.reduce((s, t) => s + Math.abs(Number(t.delta)), 0)
    expect(revokedSum).toBe(40)

    // 余额 = 流水累计（自家体检的恒等式）
    const txs = await PointTransaction.findAll({ where: { user_id: user.id } })
    const sum = txs.reduce((s, t) => s + Number(t.delta || 0), 0)
    expect(Number(bal.balance), '余额必须等于流水累计').toBe(sum)
  })

  it('BC-3 抵扣券退回未使用', async () => {
    const ids = await makeOrders(2, { eachEarn: 0, withCoupon: true })
    await bulkCancel(ids)

    const { UserCoupon } = models()
    const coupons = await UserCoupon.findAll({ where: { user_id: user.id } })
    expect(coupons.length).toBe(2)
    for (const c of coupons) {
      expect(c.status, '券必须退回未使用').toBe('unused')
      expect(c.used_by_order_id, '券不能还挂着已删的订单').toBeNull()
    }
  })

  it('BC-4 积分已被花掉的那单被跳过，其余照常回补', async () => {
    const ids = await makeOrders(3, { eachEarn: 10 })
    // 把用户余额改成只够 2 单（第三单的积分已被花掉）
    await models().UserPointBalance.update({ balance: 20, after_balance: 20 }, { where: { user_id: user.id } })

    const body = await bulkCancel(ids)
    expect(body.data.changed.length, '前两单应改成功').toBe(2)
    expect(body.data.skipped.length, '第三单应被跳过').toBe(1)
    expect(body.data.skipped[0].reason).toMatch(/积分已被使用/)

    const after = await models().Product.findByPk(product.id, { raw: true })
    expect(Number(after.stock), '只有两单回补了库存').toBe(2)
  })

  it('BC-5 查询条数不随订单数线性膨胀', async () => {
    const ids = await makeOrders(10, { eachEarn: 10 })
    const orig = sequelize.query.bind(sequelize)
    let count = 0
    sequelize.query = (...a) => { count++; return orig(...a) }
    try {
      await bulkCancel(ids)
    } finally {
      sequelize.query = orig
    }
    // 10 单：读类查询应被压到 O(1)（预取）+ 每单一次余额 + 必要的写
    // 阈值 40：优化前是 10 单 × ~5 条 ≈ 100+
    /**
     * 实测：优化前 106 条 → 优化后 68 条（10 单）。
     * 不可省的是每单的写操作（库存/订单/流水/余额各一次 ≈ 5 条），
     * 所以能省的是**读**：原来每单 2 次积分流水 + 2 次余额 + 1 次明细 = 50 条读，
     * 现在是 1 次流水 + 1 次明细 + 每单 1 次余额（余额不能跨单缓存）。
     * 阈值 80：离旧的 106 足够远（回潮会被抓到），离现在的 68 留足余量。
     */
    expect(
      count,
      `批量取消 10 单发了 ${count} 条查询（上限 80）—— 预取/共享余额行的优化回潮了`
    ).toBeLessThanOrEqual(80)
  })
})
