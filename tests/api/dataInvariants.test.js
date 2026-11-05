/**
 * 数据不变量校验器自身的测试（dataInvariants）
 *
 * 校验器是「防数据被写坏」的哨兵 —— 它自己要是坏了，等于没装。
 * 所以这里既测「干净库不报」，也测「造出违规后必须报出来」。
 *
 *   DI-1 空库：所有检查通过
 *   DI-2 库存为负 → 被抓
 *   DI-3 订单金额与明细不符 → 被抓
 *   DI-4 积分余额与流水不符 → 被抓
 *   DI-5 积分余额为负 → 被抓
 *   DI-6 已用券没挂订单 → 被抓
 *   DI-7 孤儿券（模板不存在）→ 被抓
 *   DI-8 已支付订单缺 online_paid_at → 被抓
 *   DI-9 推荐码重复 → 被抓
 *   DI-10 被推荐码指向不存在的用户 → 被抓
 *   DI-11 导出任务的文件已被删 → 被抓
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { checkDataInvariants } from '@server/utils/dataInvariants.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

/** 跑一遍校验，返回 { 名称: 违规数 } */
async function runChecks () {
  const results = await checkDataInvariants({
    sequelize: TestDatabase.getSequelize()
  })
  return Object.fromEntries(results.map(r => [r.name, r.violations]))
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('数据不变量校验器', () => {
  it('DI-1 干净库：所有检查通过', async () => {
    const counts = await runChecks()
    const bad = Object.entries(counts).filter(([, n]) => n !== 0)
    expect(bad).toEqual([])
  }, 30000)

  it('DI-2 库存为负 → 被抓', async () => {
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({ stock: -1, price: 10 }))
    const counts = await runChecks()
    expect(counts.stock_not_negative).toBeGreaterThan(0)
  }, 30000)

  it('DI-3 订单总额超过明细之和（多收钱）→ 被抓', async () => {
    const { Order, OrderItem, User, Product } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100 }))
    const order = await Order.create(await TestDataFactory.createOrder(user.id, {
      total_amount: 999
    }))
    await OrderItem.create(await TestDataFactory.createOrderItem(order.id, product.id, {
      quantity: 2,
      price: 100
    }))
    const counts = await runChecks()
    expect(counts.order_total_not_exceeding_items).toBeGreaterThan(0)
  }, 30000)

  it('DI-4 积分余额与流水累计不符 → 被抓', async () => {
    const { UserPointBalance, User } = models()
    const user = await User.create(await TestDataFactory.createUser())
    // 余额 100，但一条流水都没有 → 账实不符
    await UserPointBalance.create({ user_id: user.id, balance: 100 })
    const counts = await runChecks()
    expect(counts.points_balance_matches_ledger).toBeGreaterThan(0)
  }, 30000)

  it('DI-5 积分余额为负 → 被抓', async () => {
    const { UserPointBalance, User } = models()
    const user = await User.create(await TestDataFactory.createUser())
    await UserPointBalance.create({ user_id: user.id, balance: -5 })
    const counts = await runChecks()
    expect(counts.points_balance_not_negative).toBeGreaterThan(0)
  }, 30000)

  it('DI-6 已用券没挂订单 → 被抓', async () => {
    const { UserCoupon, CouponTemplate, User } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const template = await CouponTemplate.create({
      name: 'DI券',
      amount: 10,
      min_spend: 100,
      total: null,
      per_user: 5,
      scope: { type: 'all', ids: [] },
      status: 'active'
    })
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'DIUSED',
      status: 'used',
      used_by_order_id: null
    })
    const counts = await runChecks()
    expect(counts.coupon_used_has_order).toBeGreaterThan(0)
  }, 30000)

  it('DI-7 孤儿券（模板不存在）→ 被抓', async () => {
    const { UserCoupon, User } = models()
    // 新库有外键兜底，但老库/人工改库可能没有 —— 先摘掉约束才造得出孤儿
    await TestDatabase.getSequelize().query(
      'ALTER TABLE user_coupons DROP CONSTRAINT IF EXISTS user_coupons_template_id_fkey'
    )
    const user = await User.create(await TestDataFactory.createUser())
    await UserCoupon.create({
      template_id: 999999,
      user_id: user.id,
      code: 'DIORPHAN',
      status: 'unused'
    })
    const counts = await runChecks()
    expect(counts.coupon_template_exists).toBeGreaterThan(0)
  }, 30000)

  it('DI-8 近期在线支付订单缺 online_paid_at → 被抓', async () => {
    const { Order, User } = models()
    const user = await User.create(await TestDataFactory.createUser())
    await Order.create(await TestDataFactory.createOrder(user.id, {
      status: 'paid',
      payment_method: 'online',
      online_paid_at: null
    }))
    const counts = await runChecks()
    expect(counts.recent_paid_order_has_paid_at).toBeGreaterThan(0)
  }, 30000)

  it('DI-9 推荐码重复 → 被抓', async () => {
    const { User } = models()
    // 同理：新库有唯一索引兜底，老库/人工改库可能没有
    await TestDatabase.getSequelize().query(
      'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_referral_code_key'
    )
    await User.create(await TestDataFactory.createUser({ referral_code: 'DIREPEAT' }))
    await User.create(await TestDataFactory.createUser({ referral_code: 'DIREPEAT' }))
    const counts = await runChecks()
    expect(counts.referral_code_unique).toBeGreaterThan(0)
  }, 30000)

  it('DI-10 老数据里的悬空被推荐码不算违规（推荐人注销后其码被置空，属既定行为）', async () => {
    const { User } = models()
    await User.create(await TestDataFactory.createUser({ referred_by_code: 'DI-NOBODY' }))
    const counts = await runChecks()
    // 不再有"被推荐码必须指向真实用户"这条检查 —— 注册时后端已校验过，
    // 而推荐人注销会把 referral_code 置空，引用自然悬空，属正常
    expect(counts.referred_by_points_to_real_user).toBeUndefined()
  }, 30000)

  it('DI-12 近期订单总额与明细之和不符 → 被抓（近期严格）', async () => {
    const { Order, OrderItem, User, Product } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100 }))
    const order = await Order.create(await TestDataFactory.createOrder(user.id, { total_amount: 999 }))
    await OrderItem.create(await TestDataFactory.createOrderItem(order.id, product.id, {
      quantity: 2, price: 100
    }))
    const counts = await runChecks()
    expect(counts.recent_order_total_matches_items).toBeGreaterThan(0)
  }, 30000)

  it('DI-11 导出任务的文件已被删 → 被抓', async () => {
    const { ExportJob } = models()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    await ExportJob.create({
      admin_id: admin.id,
      admin_username: admin.username,
      type: 'users',
      status: 'done',
      params: {},
      file_path: '/tmp/di-does-not-exist-9999.xlsx'
    })
    const counts = await runChecks()
    expect(counts.export_job_file_exists).toBeGreaterThan(0)
  }, 30000)
})
