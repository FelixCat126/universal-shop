/**
 * 管理端面板：今日待办数字 + 订单多状态筛选
 *
 * 背景：面板原来只有"累计"数字（总订单/总营收/总用户/活跃用户），
 * 商家真正每天要看的是"**今天有几单要发、几单没付、几个商品要补货**"。
 * 这轮把这些"待办数"加上去，并且保证：
 *
 *   1. 卡上的数字和点进去之后列表里的条数**口径一致**（不然用户以为系统漏单）
 *   2. 低库存/缺货的口径和商品页的库存筛选**完全一致**（0<stock<=10 / stock=0）
 *
 *   DA-1 overview 返回全部待办字段
 *   DA-2 今日订单数只算今天（昨天的订单不算）
 *   DA-3 今日营收只累加今天的订单
 *   DA-4 待发货 = paid + shipping（两个状态都算）
 *   DA-5 待支付 = pending
 *   DA-6 低库存口径 0<stock<=10，缺货口径 stock=0（与商品页筛选一致）
 *   DA-7 订单列表支持逗号分隔的多状态
 *   DA-8 订单列表非法状态 → 400（别静默忽略）
 *   DA-9 导出沿用同样的多状态筛选
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { getBusinessTimezone, localCalendarDate, localDayStartUtc, addDaysToCalendarDate } from '@server/utils/businessTimezone.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return { token: TestHelpers.generateAdminToken(admin) }
}

let orderSeq = 0
const uniqueOrderNo = () => `DA${Date.now()}${orderSeq++}`

/**
 * 业务时区里的"今天 10:00"与"昨天 10:00"（UTC 瞬间）。
 *
 * ⚠️ 之前这里用「本地时间」的昨天：
 *     const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(10,0,0,0)
 *   业务口径是**业务时区**（默认 Asia/Bangkok = UTC+7）的今天，
 *   而服务器本地时区是 Asia/Shanghai（UTC+8）。
 *   于是本地 00:00–07:00 这个窗口里，「本地昨天 10:00」正好落在**曼谷的今天**
 *   → 昨天那单被算进今天 → 用例必挂。
 *   这不是业务 bug，是测试把自己的假设写死在了本地时区上。
 *
 * 现在直接按业务时区算日历日，任何时刻跑结果都一样。
 */
async function businessDayMoments () {
  const tz = await getBusinessTimezone()
  const { y, m, d } = localCalendarDate(tz)
  const prev = addDaysToCalendarDate(y, m, d, -1)
  const at = (yy, mm, dd, hour) => new Date(localDayStartUtc(tz, yy, mm, dd) + hour * 3600 * 1000)
  return {
    todayAt10: at(y, m, d, 10),
    yesterdayAt10: at(prev.y, prev.m, prev.d, 10)
  }
}

/** 造一单（默认今天创建的） */
async function mkOrder (overrides = {}) {
  const { Order, User } = models()
  let user = await User.findOne()
  if (!user) {
    user = await User.create(await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Date.now()).slice(-8)}`
    }))
  }
  return Order.create({
    order_no: uniqueOrderNo(),
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    status: 'pending',
    contact_name: 'X',
    contact_phone: '1',
    delivery_address: 'A',
    exchange_rate: 1,
    ...overrides
  })
}

describe('面板今日待办', () => {
  it('DA-1 overview 返回全部待办字段', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const d = res.body.data
    for (const key of [
      'todayOrders', 'todayAmount',
      'pendingShipment', 'pendingPayment',
      'lowStock', 'outOfStock'
    ]) {
      expect(d, `overview 缺少字段 ${key}`).toHaveProperty(key)
      expect(Number.isFinite(Number(d[key])), `${key} 必须是数字`).toBe(true)
    }
    // 金额是两位小数的字符串（与 totalAmount 同格式）
    expect(d.todayAmount).toMatch(/^\d+\.\d{2}$/)
  })

  it('DA-2 今日订单数只算今天', async () => {
    const { token } = await adminCtx()

    const { yesterdayAt10, todayAt10 } = await businessDayMoments()

    await mkOrder({ created_at: yesterdayAt10, total_amount_thb: 50 })
    await mkOrder({ created_at: todayAt10, total_amount_thb: 30 })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.data.todayOrders).toBe(1)
  })

  it('DA-3 今日营收只累加今天的订单', async () => {
    const { token } = await adminCtx()

    const { yesterdayAt10, todayAt10 } = await businessDayMoments()

    // ⚠️ 状态必须是**已成交**（shipping/completed…）：
    // 「营收」的口径是钱到账了才算，未付款（pending）与已取消（cancelled）不算。
    await mkOrder({ created_at: yesterdayAt10, total_amount_thb: 500, status: 'shipping' })
    await mkOrder({ created_at: todayAt10, total_amount_thb: 30, status: 'shipping' })
    await mkOrder({ created_at: todayAt10, total_amount_thb: 20, status: 'shipping' })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(parseFloat(res.body.data.todayAmount)).toBe(50)
  })

  it('DA-4 待发货 = paid + shipping 两个状态', async () => {
    const { token } = await adminCtx()
    await mkOrder({ status: 'paid' })
    await mkOrder({ status: 'shipping' })
    await mkOrder({ status: 'shipped' })
    await mkOrder({ status: 'completed' })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.data.pendingShipment).toBe(2)
  })

  it('DA-5 待支付 = pending', async () => {
    const { token } = await adminCtx()
    await mkOrder({ status: 'pending' })
    await mkOrder({ status: 'pending' })
    await mkOrder({ status: 'paid' })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.data.pendingPayment).toBe(2)
  })

  it('DA-6 低库存 0<stock<=10，缺货 stock=0（与商品页筛选一致）', async () => {
    const { token } = await adminCtx()
    const { Product } = models()

    await Product.create({ name: '充足', price: 10, stock: 100, status: 'active' })
    await Product.create({ name: '刚好十件', price: 10, stock: 10, status: 'active' })
    await Product.create({ name: '只剩一件', price: 10, stock: 1, status: 'active' })
    await Product.create({ name: '卖光了', price: 10, stock: 0, status: 'active' })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.data.lowStock, '低库存 = 刚好十件 + 只剩一件').toBe(2)
    expect(res.body.data.outOfStock, '缺货 = stock 为 0').toBe(1)
  })
})

describe('订单列表多状态筛选', () => {
  it('DA-7 逗号分隔的多个状态一起筛', async () => {
    const { token } = await adminCtx()
    await mkOrder({ status: 'paid' })
    await mkOrder({ status: 'shipping' })
    await mkOrder({ status: 'completed' })

    const res = await request(app).get('/api/admin/orders')
      .query({ status: 'paid,shipping' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const statuses = res.body.data.orders.map(o => o.status).sort()
    expect(statuses).toEqual(['paid', 'shipping'])
  })

  it('DA-8 非法状态 → 400', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/orders')
      .query({ status: 'paid,not_a_status' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('DA-9 导出沿用同样的多状态筛选', async () => {
    const { token } = await adminCtx()
    await mkOrder({ status: 'paid' })
    await mkOrder({ status: 'shipping' })
    await mkOrder({ status: 'completed' })

    const res = await request(app).get('/api/admin/orders/export')
      .query({ status: 'paid,shipping' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const text = res.text || ''
    // 导出的 CSV 里只应出现 paid/shipping 两单（completed 那单不该在里面）
    expect(text).toContain('paid')
    expect(text).toContain('shipping')
    expect(text).not.toContain('completed')
  })
})
