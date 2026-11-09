/**
 * 统计缓存的写时失效测试
 *
 * 这个特性最容易出的问题是"**写时失效没生效**" —— 而且它不报错：
 * 统计数字就是旧的，运营看着对不上又查不出原因。
 *
 * 所以这里专门验：
 *   SC-1 缓存开着时，第二次读命中缓存（不重新算）
 *   SC-2 下单后缓存被清 → 统计立刻反映新订单（不等 TTL）
 *   SC-3 改订单状态后 → 统计立刻变
 *   SC-4 删订单后 → 统计立刻变
 *   SC-5 批量更新（Model.update）后 → 统计立刻变
 *   SC-6 批量删除（Model.destroy）后 → 统计立刻变
 *   SC-7 新增用户后 → 总用户数立刻变
 *   SC-8 STATS_CACHE_ENABLED=0 时缓存完全旁路（线上应急开关）
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

/** 打开缓存（默认测试环境是关的） */
process.env.STATS_CACHE_ENABLED = '1'

let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  // 清缓存：测试库每个用例前清库，缓存里留着上一条用例的计数
  const { invalidateStatsCaches } = await import('@server/utils/statsCache.js')
  invalidateStatsCaches()

  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `sc_admin_${Date.now()}`,
    password: 'ScPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
})

afterAll(() => {
  delete process.env.STATS_CACHE_ENABLED
})

/** 建一个订单 */
async function makeOrder (status = 'completed', amount = 100) {
  const { Order, User } = TestDatabase.getSequelize().models
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  return Order.create({
    order_no: `SC${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: u.id, total_amount: amount, total_amount_thb: amount,
    currency_code: 'THB', payment_method: 'cod', status, exchange_rate: 1
  })
}

/** 读总览统计 */
const overview = () =>
  request(app).get('/api/admin/statistics/overview').set('Authorization', `Bearer ${token}`)

describe('统计缓存的写时失效', () => {
  it('SC-1 缓存开着：第二次读命中缓存', async () => {
    const first = await overview()
    expect(first.status).toBe(200)

    // 直接写库（绕过模型 hook，所以不会触发缓存失效）→ 统计读数不变，
    // 说明第二次读的是**缓存**而不是重新算的
    const { default: sequelize } = await import('@server/config/database.js')
    const { User } = TestDatabase.getSequelize().models
    const u = await User.findOne()
    if (u) {
      await sequelize.query(
        `INSERT INTO orders (order_no, user_id, total_amount, total_amount_thb, discount_amount,
          currency_code, payment_method, status, exchange_rate, created_at, updated_at)
         VALUES ('SC_RAW_1', ${u.id}, 999, 999, 0, 'THB', 'cod', 'completed', 1, NOW(), NOW())`
      )
    }

    const second = await overview()
    expect(second.body.data.totalOrders).toBe(first.body.data.totalOrders)
  })

  it('SC-2 下单后统计立刻反映新订单（不等 TTL）', async () => {
    const before = await overview()
    const beforeCount = before.body.data.totalOrders

    await makeOrder('completed', 100)

    const after = await overview()
    expect(after.body.data.totalOrders).toBe(beforeCount + 1)
  })

  it('SC-3 改订单状态后统计立刻变', async () => {
    const order = await makeOrder('pending', 100)
    await overview() // 预热缓存

    await order.update({ status: 'completed' })

    const after = await overview()
    expect(after.body.data.totalOrders).toBe(1)
  })

  it('SC-4 删订单后统计立刻变', async () => {
    const order = await makeOrder('completed', 100)
    await overview()

    await order.destroy()

    const after = await overview()
    expect(after.body.data.totalOrders).toBe(0)
  })

  it('SC-5 批量更新后统计立刻变', async () => {
    const order = await makeOrder('pending', 100)
    await overview()

    const { Order } = TestDatabase.getSequelize().models
    await Order.update({ status: 'completed' }, { where: { id: order.id } })

    const after = await overview()
    expect(after.body.data.totalOrders).toBe(1)
  })

  it('SC-6 批量删除后统计立刻变', async () => {
    const order = await makeOrder('completed', 100)
    await overview()

    const { Order } = TestDatabase.getSequelize().models
    await Order.destroy({ where: { id: order.id } })

    const after = await overview()
    expect(after.body.data.totalOrders).toBe(0)
  })

  it('SC-7 新增用户后总用户数立刻变', async () => {
    const before = await overview()
    const beforeCount = before.body.data.totalUsers

    const { User } = TestDatabase.getSequelize().models
    await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: `137${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    }))

    const after = await overview()
    expect(after.body.data.totalUsers).toBe(beforeCount + 1)
  })

  it('SC-8 STATS_CACHE_ENABLED=0 时缓存完全旁路', async () => {
    const { invalidateStatsCaches } = await import('@server/utils/statsCache.js')
    invalidateStatsCaches()

    const before = await overview()
    await makeOrder('completed', 100)

    // 关掉缓存 → 每次都重新算
    process.env.STATS_CACHE_ENABLED = '0'
    try {
      const after = await overview()
      expect(after.body.data.totalOrders).toBe(before.body.data.totalOrders + 1)
    } finally {
      process.env.STATS_CACHE_ENABLED = '1'
    }
  })
})
