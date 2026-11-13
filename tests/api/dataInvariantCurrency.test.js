/**
 * 数据不变量：订单金额校验的**币种**与**优惠**口径
 *
 * 这套校验是商家的"每日体检" —— 报出来的就是真问题。
 * 一旦它把**正确的订单**报成违规，运维就会照着报告去手工改数据 →
 * **把对的单改错**。所以口径必须准。
 *
 * 之前两处口径都是错的（生产实测有真实命中）：
 *   1. 拿 `total_amount`（**结算币种**金额）去比 `order_items.price`（**泰铢**单价）
 *      → 非泰铢结算的订单必然对不上
 *      （生产实测：CNY 单 total_amount=1933.47 CNY vs 明细 2762.10 THB，差 828）
 *   2. 用满减/券的订单，应付 < 明细原价和，直接比必然对不上
 *      → 正确式是：total_amount_thb = 明细原价和 − Σdiscount_allocated
 *
 *   DI-1 泰铢订单：总额 = 明细原价和 − 分摊优惠 → 不报
 *   DI-2 非泰铢（CNY）订单 → 不报（旧口径会误报）
 *   DI-3 用了满减的订单 → 不报（旧口径会误报）
 *   DI-4 真的多收了钱 → **仍然要报**（校验不能被改成永远通过）
 *   DI-5 真的总额对不上（人为改坏）→ 仍然要报
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { checkDataInvariants } from '@server/utils/dataInvariants.js'
import { TestDataFactory } from '../factories/index.js'

const models = () => TestDatabase.getSequelize().models

let user

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { User } = models()
  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
})

/** 造一单：items = [{price, qty, alloc}]，totalThb 是应付（泰铢） */
async function mkOrder ({ totalThb, totalAmount, currency = 'THB', items = [{ price: 100, qty: 1, alloc: 0 }] }) {
  const { Order, OrderItem, Product } = models()
  // 明细行要挂一个真实商品（product_id 非空）
  const product = await Product.create({
    name: `DI商品${Math.random().toString(36).slice(2, 8)}`,
    price: 100, stock: 999, status: 'active'
  })
  const order = await Order.create({
    order_no: `DI${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: totalAmount ?? totalThb,
    total_amount_thb: totalThb,
    currency_code: currency,
    payment_method: 'cod',
    status: 'shipping',
    exchange_rate: 1
  })
  for (const it of items) {
    await OrderItem.create({
      order_id: order.id,
      product_id: product.id,
      quantity: it.qty,
      price: it.price,
      original_price: it.price,
      discount_allocated: it.alloc || 0
    })
  }
  return order
}

/** 跑校验，返回命中的检查项名 */
async function violations () {
  const res = await checkDataInvariants({ sequelize: TestDatabase.getSequelize() })
  // violations > 0 表示命中（-1 表示查询出错，也算命中）
  return res.filter(c => c.violations > 0).map(c => c.name)
}

describe('订单金额校验的口径', () => {
  it('DI-1 泰铢订单：总额 = 明细原价和 − 分摊优惠 → 不报', async () => {
    await mkOrder({
      totalThb: 90,
      items: [{ price: 100, qty: 1, alloc: 10 }]
    })
    const v = await violations()
    expect(v).not.toContain('recent_order_total_matches_items')
    expect(v).not.toContain('order_total_not_exceeding_items')
  })

  it('DI-2 非泰铢（CNY）订单 → 不报（旧口径会误报）', async () => {
    // 结算币种是人民币：total_amount 是 CNY 金额，明细单价是泰铢
    await mkOrder({
      totalThb: 2762.10,
      totalAmount: 1933.47,
      currency: 'CNY',
      items: [{ price: 2762.10, qty: 1, alloc: 0 }]
    })
    const v = await violations()
    expect(v, 'CNY 订单不该被判违规').not.toContain('recent_order_total_matches_items')
    expect(v).not.toContain('order_total_not_exceeding_items')
  })

  it('DI-3 用了满减的订单 → 不报（旧口径会误报）', async () => {
    // 明细原价 297、分摊优惠 30 → 应付 267
    await mkOrder({
      totalThb: 267,
      items: [{ price: 297, qty: 1, alloc: 30 }]
    })
    const v = await violations()
    expect(v).not.toContain('recent_order_total_matches_items')
  })

  it('DI-4 真的多收了钱 → 仍然要报（校验不能被改成永远通过）', async () => {
    // 明细原价 100，声称收了 200 → 多收
    await mkOrder({
      totalThb: 200,
      items: [{ price: 100, qty: 1, alloc: 0 }]
    })
    const v = await violations()
    expect(v).toContain('order_total_not_exceeding_items')
  })

  it('DI-5 真的总额对不上 → 仍然要报', async () => {
    // 明细原价 100 + 优惠 10 = 应付 90，但库里写的是 95 → 对不上
    await mkOrder({
      totalThb: 95,
      items: [{ price: 100, qty: 1, alloc: 10 }]
    })
    const v = await violations()
    expect(v).toContain('recent_order_total_matches_items')
  })
})

describe('积分归档与体检口径', () => {
  it('DI-6 清理旧积分流水后，体检仍然通过（归档净额被记账）', async () => {
    const { User, PointTransaction, UserPointBalance } = models()
    const { cleanupRetentionData } = await import('@server/services/retentionService.js')

    // 一个"很老"的用户：余额 100，流水 +100（created_at 已是两年前）
    const old = new Date()
    old.setFullYear(old.getFullYear() - 2)
    const u = await User.create({
      username: 'old_points_user', nickname: '老用户', phone: '812345099',
      country_code: '+66', password: 'Abcd1234', is_active: true
    })
    await UserPointBalance.create({ user_id: u.id, balance: 100, total_earned: 100, total_spent: 0 })
    await PointTransaction.create({
      user_id: u.id, order_id: null, type: 'earn_purchase', delta: 100,
      balance_after: 100, description: '很久以前的积分', created_at: old
    })

    // 跑清理（默认清 730 天前的流水）
    await cleanupRetentionData({ pointDays: 730 })

    // 流水应被清掉
    expect(await PointTransaction.count({ where: { user_id: u.id } })).toBe(0)

    // 余额一分不能少
    const bal = await UserPointBalance.findOne({ where: { user_id: u.id } })
    expect(Number(bal.balance), '清理流水不能动用户余额').toBe(100)
    // 归档净额被记下来了
    expect(Number(bal.archived_delta), '被清掉的流水净额应被记账').toBe(100)

    // 体检必须仍然通过（否则每日体检永久报红）
    const res = await checkDataInvariants({ sequelize: TestDatabase.getSequelize() })
    const failed = res.filter(c => c.violations > 0).map(c => c.name)
    expect(failed, `体检报红：${failed.join(',')}`).not.toContain('points_balance_matches_ledger')
  })
})

describe('引用完整性体检能真的发现孤儿', () => {
  it('DI-7 造一个孤儿明细行 → 体检必须报出来', async () => {
    const { AfterSale, User, Order } = models()
    const u = await User.create({
      username: 'orphan_holder', nickname: '孤儿宿主', phone: '812345099',
      country_code: '+66', password: 'Abcd1234', is_active: true
    })
    const order = await Order.create({
      order_no: 'DI7ORDER', user_id: u.id,
      total_amount: 10, total_amount_thb: 10,
      currency_code: 'THB', payment_method: 'cod', status: 'shipping',
      contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
      exchange_rate: 1
    })
    // after_sales.user_id 是全库唯一**没有外键保护**的用户引用 → 能造出孤儿
    await AfterSale.create({
      order_id: order.id, user_id: 99999999, type: 'refund', status: 'pending',
      reason: '孤儿测试', amount: 10
    })

    const res = await checkDataInvariants({ sequelize: TestDatabase.getSequelize() })
    const failed = res.filter(c => c.violations > 0).map(c => c.name)
    expect(failed, '孤儿售后单应被体检抓到').toContain('after_sale_user_exists')
  })
})
