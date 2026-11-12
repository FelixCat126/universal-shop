/**
 * 管理端订单列表：日期筛选不许崩，且口径要和面板统计一致
 *
 * 曾经的真实故障：管理端订单页的 el-date-picker 没带 value-format，
 * v-model 是 **Date 对象** → URLSearchParams 把它序列化成
 * "Thu Nov 12 2026 00:00:00 GMT+0800 (China Standard Time)"
 * → PostgreSQL 报 `time zone "gmt+0800" not recognized` → 接口 500。
 * 而且 30 秒自动刷新会**每 30 秒再崩一次**，直到运营手动点「重置」。
 *
 * 现在：
 *   - 前端补了 value-format（传 YYYY-MM-DD 字符串）
 *   - 后端改用 applyCreatedBetween：非法日期安全忽略、按**本地日历日**筛选
 *
 *   DF-1 非法日期 → 200（不再 500），且忽略该条件返回全量
 *   DF-2 Date 对象序列化成的那种串 → 同样不崩
 *   DF-3 合法日期区间 → 只返回区间内的订单（含起止日）
 *   DF-4 只给一个日期 → 按该日筛选（不再静默失效）
 *   DF-5 导出用同样的日期参数 → 不崩、且导出内容与列表一致
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let token
let seq = 0

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)
})

/** 造一单，created_at 可指定 */
async function mkOrder (createdAt, tag = 'X') {
  const { Order, User } = models()
  let user = await User.findOne()
  if (!user) {
    user = await User.create(await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Date.now()).slice(-8)}`
    }))
  }
  return Order.create({
    order_no: `DF${Date.now()}${seq++}`,
    user_id: user.id,
    total_amount: 100, total_amount_thb: 100, currency_code: 'THB',
    payment_method: 'cod', status: 'shipping',
    contact_name: tag, contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1,
    created_at: createdAt,
    updated_at: createdAt
  })
}

/** 本地日历日字符串 */
function ymd (d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('管理端订单日期筛选', () => {
  it('DF-1 非法日期 → 200（不再 500）', async () => {
    await mkOrder(new Date())
    const res = await request(app).get('/api/admin/orders')
      .query({ startDate: 'not-a-date', endDate: '???' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status, `非法日期不该 500：${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body.data.orders.length).toBe(1)
  })

  it('DF-2 Date 对象序列化成的那种串 → 不崩', async () => {
    await mkOrder(new Date())
    // 这是 el-date-picker 没有 value-format 时 URLSearchParams 产生的东西
    const dateObj = new Date(2026, 4, 12)
    const res = await request(app).get('/api/admin/orders')
      .query({ startDate: dateObj.toString(), endDate: dateObj.toString() })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status, `Date 串不该 500：${JSON.stringify(res.body)}`).toBe(200)
  })

  it('DF-3 合法日期区间 → 只返回区间内的订单（含起止日）', async () => {
    const d = (day) => {
      const dt = new Date()
      dt.setDate(dt.getDate() - day)
      dt.setHours(12, 0, 0, 0)
      return dt
    }
    await mkOrder(d(1), '昨天')
    await mkOrder(d(3), '三天前')
    await mkOrder(d(9), '九天前')

    const today = new Date()
    const start = ymd(d(2))
    const end = ymd(today)

    const res = await request(app).get('/api/admin/orders')
      .query({ startDate: start, endDate: end })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const names = res.body.data.orders.map(o => o.contact_name).sort()
    expect(names, `区间 [${start}, ${end}] 应含昨天与今天，不含九天前`).toEqual(['昨天'])
  })

  it('DF-4 只给一个日期 → 按该日筛选（不再静默失效）', async () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const old = new Date()
    old.setDate(old.getDate() - 9)
    old.setHours(12, 0, 0, 0)

    await mkOrder(today, '今天')
    await mkOrder(old, '九天前')

    const res = await request(app).get('/api/admin/orders')
      .query({ startDate: ymd(today), endDate: ymd(today) })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.orders.map(o => o.contact_name)).toEqual(['今天'])
  })

  it('DF-5 导出用同样的日期参数 → 不崩且与列表一致', async () => {
    const d = (day) => {
      const dt = new Date()
      dt.setDate(dt.getDate() - day)
      dt.setHours(12, 0, 0, 0)
      return dt
    }
    await mkOrder(d(1), '昨天')
    await mkOrder(d(9), '九天前')

    const today = new Date()
    const res = await request(app).get('/api/admin/orders/export')
      .query({ startDate: ymd(d(2)), endDate: ymd(today) })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status, `导出不该 500：${res.text?.slice(0, 200)}`).toBe(200)
    const text = res.text || ''
    expect(text).toContain('昨天')
    expect(text).not.toContain('九天前')
  })
})
