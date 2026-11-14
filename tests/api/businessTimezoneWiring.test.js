/**
 * 业务时区的**端到端接线**证明：改配置 → 报表口径真的跟着变
 *
 * 工具层算对了不等于接对了 —— 这里从 HTTP 入口验证：
 *   1. 「今日营收」按配置时区切（跨时区的那笔订单，在 A 时区算今天、在 B 时区算昨天）
 *   2. 订单列表的日期筛选按配置时区切（"选 3 月 10 日" 含不含边界订单，跟着时区变）
 *   3. 改配置后统计缓存不返回旧口径
 *   4. 非法时区名被配置接口拒绝
 *
 *   BW-1 今日营收跟随业务时区
 *   BW-2 日期筛选跟随业务时区
 *   BW-3 改时区后统计缓存不串味
 *   BW-4 配置接口只接受合法时区名
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import SystemConfig from '@server/models/SystemConfig.js'

const models = () => TestDatabase.getSequelize().models

let adminToken

/**
 * 冻结时钟（只假 Date，定时器仍是真实的 —— 否则 DB 驱动会卡住）。
 *
 * "今日营收"是**相对当下**的口径，不冻结就没法稳定地验证：
 * 上海与曼谷相差 1 小时，只有把当下钉在两者日界错开的那一刻，
 * 同一笔订单才会"在 A 时区算今天、在 B 时区算昨天"。
 */
const FROZEN_NOW = new Date('2026-03-10T16:30:00Z')
//   上海 UTC+8 → 2026-03-11 00:30（今天 = 3/11）
//   曼谷 UTC+7 → 2026-03-10 23:30（今天 = 3/10）

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FROZEN_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/** 造一笔订单：给 created_at 指定时刻（决定它落在哪个时区的"哪一天"） */
async function mkOrder (createdAt, amount = 100) {
  const { Order, OrderItem, Product, User } = models()
  const user = await User.create({
    username: `tz_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    nickname: '时区用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    password: 'Abcd1234',
    is_active: true
  })
  const product = await Product.create({ name: '时区商品', price: amount, stock: 100, status: 'active' })
  const order = await Order.create({
    order_no: `tz_o_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    user_id: user.id,
    total_amount: amount,
    total_amount_thb: amount,
    currency_code: 'THB',
    payment_method: 'cod',
    status: 'completed',
    contact_name: '时区测试',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1,
    created_at: createdAt,
    updated_at: createdAt
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 1,
    price: amount,
    original_price: amount,
    product_name_zh: product.name,
    created_at: createdAt,
    updated_at: createdAt
  })
  return order
}

describe('业务时区端到端接线', () => {
  it('BW-1 今日营收跟随业务时区', async () => {
    /**
     * 订单落在 2026-03-09T17:30:00Z：
     *   - 曼谷 UTC+7 → 2026-03-10 00:30 → **3 月 10 日** = 曼谷的"今天" ✅
     *   - 上海 UTC+8 → 2026-03-10 01:30 → 3 月 10 日 = 上海的"昨天" ❌
     * （当下冻结在 2026-03-10T16:30:00Z：曼谷今天 = 3/10，上海今天 = 3/11）
     */
    const at = new Date('2026-03-09T17:30:00Z')
    await mkOrder(at, 250)

    // 业务时区 = 上海 → 该单属于"3 月 11 日"（今天）
    await SystemConfig.setConfig('business_timezone', 'Asia/Shanghai', 'text', 'tz')
    const sh = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(sh.status).toBe(200)
    const shToday = Number(sh.body?.data?.todayAmount || 0)

    // 业务时区 = 曼谷 → 该单属于"3 月 10 日"（不是今天）
    await SystemConfig.setConfig('business_timezone', 'Asia/Bangkok', 'text', 'tz')
    const bk = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(bk.status).toBe(200)
    const bkToday = Number(bk.body?.data?.todayAmount || 0)

    expect(bkToday, '曼谷口径下这笔应算今日营收').toBeGreaterThan(0)
    expect(shToday, '上海口径下这笔不属于今日（跨了一天）').toBe(0)
  })

  it('BW-2 日期筛选跟随业务时区', async () => {
    /**
     * 订单落在 2026-03-09T16:30:00Z：
     *   - 曼谷 UTC+7 → 2026-03-09 23:30 → 日历日 **3 月 9 日**
     *   - 上海 UTC+8 → 2026-03-10 00:30 → 日历日 **3 月 10 日**
     * 于是"选 3 月 10 日"：上海应命中、曼谷不应命中。
     */
    const at = new Date('2026-03-09T16:30:00Z')
    const order = await mkOrder(at, 250)

    // 上海口径：这笔落在 3 月 10 日 → 选 3 月 10 日应命中
    await SystemConfig.setConfig('business_timezone', 'Asia/Shanghai', 'text', 'tz')
    const sh = await request(app).get('/api/admin/orders?startDate=2026-03-10&endDate=2026-03-10')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(sh.status).toBe(200)
    const shIds = (sh.body?.data?.orders || sh.body?.data || []).map(o => o.id)
    expect(shIds, '上海口径：3 月 10 日应包含这笔').toContain(order.id)

    // 曼谷口径：这笔落在 3 月 9 日 → 选 3 月 10 日不应命中
    await SystemConfig.setConfig('business_timezone', 'Asia/Bangkok', 'text', 'tz')
    const bk = await request(app).get('/api/admin/orders?startDate=2026-03-10&endDate=2026-03-10')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(bk.status).toBe(200)
    const bkIds = (bk.body?.data?.orders || bk.body?.data || []).map(o => o.id)
    expect(bkIds, '曼谷口径：3 月 10 日不应包含这笔').not.toContain(order.id)
  })

  it('BW-3 改时区后统计缓存不串味', async () => {
    const at = new Date('2026-03-09T17:30:00Z')
    await mkOrder(at, 250)

    await SystemConfig.setConfig('business_timezone', 'Asia/Bangkok', 'text', 'tz')
    const first = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(Number(first.body?.data?.todayAmount || 0), '曼谷口径下这笔应算今日').toBeGreaterThan(0)

    // 改成上海后立刻再查 —— 不能返回曼谷口径的旧缓存
    await SystemConfig.setConfig('business_timezone', 'Asia/Shanghai', 'text', 'tz')
    const second = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(Number(second.body?.data?.todayAmount || 0), '改时区后仍返回旧口径的缓存').toBe(0)
  })

  it('BW-4 配置接口只接受合法时区名', async () => {
    const bad = await request(app).post('/api/system-config/')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'business_timezone', value: "Asia/Bangkok'; DROP TABLE orders; --", type: 'text' })
    expect(bad.status, '非法时区名必须被拒（它会被拼进 SQL）').toBe(400)

    const good = await request(app).post('/api/system-config/')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'business_timezone', value: 'Asia/Bangkok', type: 'text' })
    expect(good.status).toBe(200)
    expect(good.body?.data?.business_timezone).toBe('Asia/Bangkok')
  })
})
