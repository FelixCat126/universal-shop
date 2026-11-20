/**
 * 全局加锁顺序的契约测试（第 44 轮 · 架构审查⑥）
 * =========================================
 *
 * ## 约定
 *
 * 全站写路径取行锁的顺序必须一致：
 *
 *   **Product（product_id 升序） → UserCoupon → UserPointBalance**
 *
 * 下单路径一直遵守；取消/回补路径原来是"积分 → 券"（反了），
 * 批量取消还**提前**给积分余额行加了 FOR UPDATE（变成"余额 → 商品"，与下单完全相反）。
 *
 * ## 为什么这要命
 *
 * 两笔事务各按相反顺序拿两把锁 → 互等 → PG 判定死锁（40P01）→ 整事务回滚。
 * 有 `withDeadlockRetry` 时表现为"慢一点"，没有时就是 **500**。
 *
 * 第 44 轮把两条取消路径都改成统一顺序（顺带修掉了批量路径那个
 * "提前锁余额"的写法 —— 单条路径早就改好了，批量路径没跟上）。
 *
 * ## 为什么用"捕获 SQL"来断言，而不是靠并发压测
 *
 * 死锁是概率事件：压测 100 轮没撞上，不能证明设计是对的。
 * 而"先锁了哪张表、后锁了哪张表"是**确定性的事实** ——
 * 直接看这一事务实际下发的 SQL 顺序，结论唯一。
 * （项目里已有同类做法：深翻页护栏就是断言实际下发的 OFFSET 数值。）
 *
 * ## 用例
 *   LO-1 单条取消：商品 → 券 → 积分余额
 *   LO-2 批量取消：商品 → 券 → 积分余额（**第 44 轮修的就是这条**）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let captured = []
let originalLogging = null

function captureSql () {
  const seq = TestDatabase.getSequelize()
  originalLogging = seq.options.logging
  captured = []
  seq.options.logging = (sql) => { captured.push(sql) }
}

function restoreLogging () {
  const seq = TestDatabase.getSequelize()
  if (originalLogging !== null) seq.options.logging = originalLogging
}

/** 在捕获到的 SQL 里找第一处匹配的位置（找不到返回 -1） */
function firstIndex (pattern) {
  return captured.findIndex(sql => pattern.test(sql))
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  captureSql()
})

afterEach(() => {
  restoreLogging()
})

/**
 * 造一笔"发了购物积分"的订单：
 * 取消它时才会走"收回购物积分"→ 才会去锁积分余额行（FOR UPDATE）。
 */
async function makeOrderWithEarnedPoints ({ quantity = 2, price = 50, status = 'shipping' } = {}) {
  const { User, Product, Order, OrderItem, UserPointBalance, PointTransaction } = models()

  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900004444'
  }))
  const product = await Product.create(TestDataFactory.createProduct({
    stock: 100, price, name: '锁序测试商品'
  }))
  const order = await Order.create({
    order_no: `LO${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: price * quantity,
    total_amount_thb: price * quantity,
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    contact_name: 'X',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity,
    price,
    original_price: price,
    product_name_zh: '锁序测试商品'
  })
  // 余额行 + 购物积分流水（earn_purchase）
  await UserPointBalance.create({ user_id: user.id, balance: 100, archived_delta: 0 })
  await PointTransaction.create({
    user_id: user.id,
    order_id: order.id,
    type: 'earn_purchase',
    delta: 10,
    balance_after: 100,
    description: '购物赠送积分'
  })
  return { user, product, order }
}

describe('全局加锁顺序契约', () => {
  it('LO-1 单条取消：商品 → 券 → 积分余额', async () => {
    const { order } = await makeOrderWithEarnedPoints()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const token = TestHelpers.generateAdminToken(admin)

    captured = []
    const res = await request(app).put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'cancelled' })
    expect(res.status, '取消订单应当成功').toBe(200)

    /**
     * 表名在测试库里是 schema 限定的（每文件独立 schema）：
     *   UPDATE "t_xxx"."products" SET ...
     * 所以正则不能写死 `"products"`，用词边界匹配表名即可。
     */
    const iProduct = firstIndex(/UPDATE\s+[\s\S]*?\bproducts\b/i)
    const iCoupon = firstIndex(/UPDATE\s+[\s\S]*?\buser_coupons\b/i)
    const iBalance = firstIndex(/SELECT\s+[\s\S]*?\buser_point_balances\b[\s\S]*?FOR UPDATE/i)

    expect(iProduct, '应当有回补库存的 UPDATE').toBeGreaterThanOrEqual(0)
    expect(iCoupon, '应当有释放抵扣券的 UPDATE').toBeGreaterThanOrEqual(0)
    expect(iBalance, '应当有锁积分余额行的 SELECT ... FOR UPDATE').toBeGreaterThanOrEqual(0)
    expect(
      iProduct < iCoupon,
      `商品行锁必须早于券（实际 商品=${iProduct} 券=${iCoupon}）—— 与下单路径同序才不会成环`
    ).toBe(true)
    expect(
      iCoupon < iBalance,
      `券必须早于积分余额（实际 券=${iCoupon} 余额=${iBalance}）—— 下单路径是"核销券 → 扣积分"`
    ).toBe(true)
  })

  it('LO-2 批量取消：商品 → 券 → 积分余额（第 44 轮修掉"提前锁余额"）', async () => {
    const { order } = await makeOrderWithEarnedPoints()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const token = TestHelpers.generateAdminToken(admin)

    captured = []
    const res = await request(app).post('/api/admin/orders/bulk/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [order.id], status: 'cancelled' })
    expect(res.status, '批量取消应当成功').toBe(200)
    expect(res.body?.changed ?? res.body?.data?.changed, '这一单应当被取消').toContain(order.id)

    /**
     * 表名在测试库里是 schema 限定的（每文件独立 schema）：
     *   UPDATE "t_xxx"."products" SET ...
     * 所以正则不能写死 `"products"`，用词边界匹配表名即可。
     */
    const iProduct = firstIndex(/UPDATE\s+[\s\S]*?\bproducts\b/i)
    const iCoupon = firstIndex(/UPDATE\s+[\s\S]*?\buser_coupons\b/i)
    const iBalance = firstIndex(/SELECT\s+[\s\S]*?\buser_point_balances\b[\s\S]*?FOR UPDATE/i)

    expect(iProduct, '应当有回补库存的 UPDATE').toBeGreaterThanOrEqual(0)
    expect(iCoupon, '应当有释放抵扣券的 UPDATE').toBeGreaterThanOrEqual(0)
    expect(iBalance, '应当有锁积分余额行的 SELECT ... FOR UPDATE').toBeGreaterThanOrEqual(0)
    expect(
      iProduct < iCoupon,
      `商品行锁必须早于券（实际 商品=${iProduct} 券=${iCoupon}）`
    ).toBe(true)
    expect(
      iCoupon < iBalance,
      `券必须早于积分余额（实际 券=${iCoupon} 余额=${iBalance}）`
    ).toBe(true)
    /**
     * 这一条是第 44 轮修的**核心**：批量路径原来在回补库存**之前**
     * 就给积分余额行加了 FOR UPDATE → 顺序变成"余额 → 商品"，
     * 与下单路径（商品 → 余额）完全相反 → 会成环。
     *
     * 修法：批量路径改用与单条路径同一个**非加锁**守卫，
     * 于是这个事务里第一次碰积分余额行就是收回积分时（在商品之后）。
     */
    expect(
      iProduct < iBalance,
      `积分余额行不能在商品行之前被锁（实际 商品=${iProduct} 余额=${iBalance}）—— ` +
      '批量路径曾经在回补库存前就 FOR UPDATE 余额行，与下单路径反序'
    ).toBe(true)
  })
})
