/**
 * 订单列表的**业务时区**一致性
 *
 * ## 为什么要有这个
 *
 * 第 16 轮把"今天"从服务器本地时区改成了业务时区（business_timezone 配置），
 * 但**前端兜底路径**还在按浏览器本地时区算"今天" —— 运营一旦把业务时区
 * 改成 Asia/Bangkok，服务端的"今日营收"和前端兜底的"今日营收"就对不上了。
 *
 * 现在：服务端把业务时区随列表一起返回（data.timezone），前端兜底按它算。
 *
 *   TZ-1 响应里的 timezone = 配置的业务时区
 *   TZ-2 改业务时区后，"今日营收"跟着业务时区走（不是服务器时区）
 *   TZ-3 前端兜底按服务端给的时区算（源码级断言）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import SystemConfig from '@server/models/SystemConfig.js'

const models = () => TestDatabase.getSequelize().models

let token

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)
})

/** 造一张指定时刻创建的订单 */
async function mkOrder (createdAt, amount = 100) {
  const { Order, User } = models()
  const user = await User.create({
    username: 'tz_u_' + Date.now(), nickname: '时区用户', country_code: '+86',
    phone: '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
    password: 'Abcd1234', is_active: true
  })
  return Order.create({
    order_no: 'TZ' + Date.now() + Math.random().toString(36).slice(2, 7),
    user_id: user.id, total_amount: amount, total_amount_thb: amount,
    currency_code: 'THB', payment_method: 'cod', status: 'completed',
    contact_name: '时区', contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1, created_at: createdAt, updated_at: createdAt
  })
}

describe('订单列表的业务时区', () => {
  it('TZ-1 响应里的 timezone = 配置的业务时区', async () => {
    await SystemConfig.setConfig('business_timezone', 'Asia/Bangkok', 'text', 'tz')
    const res = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body?.data?.timezone).toBe('Asia/Bangkok')
  })

  it('TZ-2 "今日营收"按业务时区切（而不是服务器时区）', async () => {
    // 2026-03-10T16:30:00Z
    //   曼谷 UTC+7 → 3 月 10 日 23:30 → 属于曼谷的"3 月 10 日"
    //   上海 UTC+8 → 3 月 11 日 00:30 → 属于上海的"3 月 11 日"
    // 同一瞬间，在两个时区落在**不同的日历日** → 能分辨口径跟的是谁。
    // 冻结时钟到两个时区日界错开的那个瞬间：
    //   曼谷 UTC+7 → 3 月 10 日 23:30（曼谷的今天）
    //   上海 UTC+8 → 3 月 11 日 00:30（上海的昨天）
    // 不冻结的话，"今天"是真实的当下（11 月），那笔 3 月的单根本不在今天里。
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-10T16:30:00Z'))
    // 订单时刻比当下早一小时：16:30Z 落在上海 3/11 的区间内（[3/10 16:00Z, ...)），
    // 15:30Z 才落在「曼谷的今天、上海的昨天」。
    const at = new Date('2026-03-10T15:30:00Z')
    await mkOrder(at, 100)

    await SystemConfig.setConfig('business_timezone', 'Asia/Bangkok', 'text', 'tz')
    const bk = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${token}`)
    expect(bk.status).toBe(200)
    // 曼谷口径：这张单在"今天" → 计入
    expect(Number(bk.body?.data?.stats?.todayAmount), '曼谷口径下该单应计入今日营收').toBe(100)

    await SystemConfig.setConfig('business_timezone', 'Asia/Shanghai', 'text', 'tz')
    const sh = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${token}`)
    expect(sh.status).toBe(200)
    // 上海口径：这张单在"昨天" → 不计入
    expect(Number(sh.body?.data?.stats?.todayAmount), '上海口径下该单不该计入今日营收').toBe(0)
  })

  it('TZ-3 前端兜底按服务端给的时区算"今天"', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/admin/views/Orders.vue'), 'utf-8'
    )
    // 必须用服务端返回的业务时区，而不是浏览器本地时区
    expect(src).toContain('serverTimezone')
    expect(src).toContain('Intl.DateTimeFormat')
    // 旧的按本地时区算的写法不能回来
    expect(src).not.toMatch(/toDateString\(\)\s*===/)
  })
})
