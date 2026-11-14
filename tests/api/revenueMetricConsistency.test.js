/**
 * 营收口径的**跨端一致性**护栏
 *
 * ## 为什么要有这个
 *
 * 「营收 / 累计消费」这个数字出现在三个地方：
 *   - 管理端面板的总营收 / 今日营收（statisticsController）
 *   - 管理端订单列表的今日营收（orderController）
 *   - 门户个人中心的累计消费（userController）
 *
 * 历史上它们**各写一遍口径**，结果"同一个指标在四个地方四个数"。
 * 现在统一到 `constants/revenueStatus.js`，但"统一"这件事本身需要有人守着 ——
 * 口径一旦在某一处被单独改掉，数字就会开始漂移，而且**没人会发现**。
 *
 * ## 口径
 *
 * 计入营收：status 不在 ('pending','cancelled') **且** payment_method 不是 'points'
 * 排除：
 *   - pending（没付款）
 *   - cancelled（已取消）
 *   - points（积分换购，用积分付的钱）
 *
 * 排除项里特别要盯住 points：它靠"金额恒为 0"其实不影响数值，
 * 但一旦有历史遗留的积分单金额非 0，没有显式排除的地方就会多算。
 *
 *   RM-1 面板总营收 = 订单列表今日营收 = 门户累计消费（同一批数据下三者相等）
 *   RM-2 pending / cancelled / points 单都不计入（三处都不计）
 *   RM-3 金额非 0 的积分单也不计入（口径不依赖"积分单金额恒为 0"这个前提）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'

const models = () => TestDatabase.getSequelize().models

let user
let userToken
let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  userToken = TestHelpers.generateToken(user)
})

/** 造一张订单（默认今天创建） */
async function mkOrder (status, amount, { paymentMethod = 'cod', daysAgo = 0 } = {}) {
  const created = new Date(Date.now() - daysAgo * 86400000)
  return models().Order.create({
    order_no: `RM${Date.now()}${Math.floor(Math.random() * 10000)}`,
    user_id: user.id,
    total_amount: amount,
    total_amount_thb: amount,
    currency_code: 'THB',
    payment_method: paymentMethod,
    status,
    contact_name: '口径',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1,
    created_at: created,
    updated_at: created
  })
}

/** 三个地方各自的营收数字 */
async function readThree () {
  const dash = await request(app).get('/api/admin/statistics/overview')
    .set('Authorization', `Bearer ${adminToken}`)
  expect(dash.status).toBe(200)

  const list = await request(app).get('/api/admin/orders')
    .set('Authorization', `Bearer ${adminToken}`)
  expect(list.status).toBe(200)

  const me = await request(app).get('/api/users/profile/metrics')
    .set('Authorization', `Bearer ${userToken}`)
  expect(me.status).toBe(200)

  return {
    dashboard: Number(dash.body?.data?.totalAmount || 0),
    orderList: Number(list.body?.data?.stats?.todayAmount || 0),
    portal: Number(me.body?.data?.spent_thb || 0)
  }
}

describe('营收口径跨端一致', () => {
  it('RM-1 面板 / 订单列表 / 门户三处数字相等', async () => {
    await mkOrder('completed', 100)          // 计入
    await mkOrder('shipping', 200)           // 计入
    await mkOrder('paid', 300)               // 计入

    const t = await readThree()
    expect(t.dashboard).toBe(600)
    expect(t.orderList, '订单列表的今日营收').toBe(600)
    expect(t.portal, '门户的累计消费').toBe(600)
  })

  it('RM-2 pending / cancelled 不计入营收', async () => {
    await mkOrder('completed', 100)
    await mkOrder('pending', 555)
    await mkOrder('cancelled', 777)

    const t = await readThree()
    expect(t.dashboard).toBe(100)
    expect(t.orderList).toBe(100)
    expect(t.portal).toBe(100)
  })

  it('RM-3 金额非 0 的积分单也不计入（不依赖"积分单金额恒为 0"）', async () => {
    await mkOrder('completed', 100)
    // 模拟历史遗留的积分单：金额非 0
    await mkOrder('completed', 500, { paymentMethod: 'points' })

    const t = await readThree()
    expect(t.dashboard, '面板不能把积分单算进营收').toBe(100)
    expect(t.orderList, '订单列表不能把积分单算进营收').toBe(100)
    expect(t.portal, '门户累计消费不能把积分单算进去').toBe(100)
  })
})
