/**
 * 「营收 / 累计消费」全站同一口径
 *
 * 同一个指标（钱到账了多少钱）在四个地方各算各的：
 *   面板总营收 / 面板今日营收 / 订单列表今日营收 / 门户个人中心累计消费
 * → 商家看着面板的营收比实际到账多，去对账时对不上，以为系统算错了。
 *
 * 口径（项目里早已确立，见 orderController 的 SPENT_EXCLUDED_STATUSES）：
 *   **钱到账了才算** —— pending（没付）与 cancelled（已取消）不算。
 *
 *   RV-1 面板总营收排除未付与已取消
 *   RV-2 面板今日营收排除未付与已取消
 *   RV-3 订单列表的金额统计与面板一致（无状态筛选时）
 *   RV-4 门户个人中心累计消费排除未付与已取消
 *   RV-5 有状态筛选时尊重筛选（筛 pending 就看 pending 的金额）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let user
let userToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)

  const { User } = models()
  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  userToken = TestHelpers.generateToken(user)
})

let seq = 0
/** 造一单 */
async function mkOrder (status, amount) {
  const { Order } = models()
  return Order.create({
    order_no: `RV${Date.now()}${seq++}`,
    user_id: user.id,
    total_amount: amount, total_amount_thb: amount,
    currency_code: 'THB', payment_method: 'cod', status,
    contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1
  })
}

describe('营收口径全站统一', () => {
  it('RV-1 面板总营收排除未付与已取消', async () => {
    await mkOrder('completed', 100)
    await mkOrder('pending', 500)
    await mkOrder('cancelled', 300)

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(parseFloat(res.body.data.totalAmount), '总营收只算真实成交').toBe(100)
  })

  it('RV-2 面板今日营收排除未付与已取消', async () => {
    await mkOrder('completed', 100)
    await mkOrder('pending', 500)

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(parseFloat(res.body.data.todayAmount)).toBe(100)
    // 今日订单数仍是全部下单（没付的单也是单）
    expect(res.body.data.todayOrders).toBe(2)
  })

  it('RV-3 订单列表的金额统计与面板一致（无状态筛选时）', async () => {
    await mkOrder('completed', 100)
    await mkOrder('pending', 500)

    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(Number(res.body.data.stats.totalAmount), '总金额与面板同口径').toBe(100)
    expect(Number(res.body.data.stats.todayAmount)).toBe(100)
  })

  it('RV-4 门户个人中心累计消费排除未付与已取消', async () => {
    await mkOrder('completed', 100)
    await mkOrder('pending', 500)
    await mkOrder('cancelled', 300)

    const res = await request(app).get('/api/users/profile/metrics')
      .set('Authorization', `Bearer ${userToken}`)

    expect(res.status).toBe(200)
    expect(Number(res.body.data.spent_thb), '累计消费只算真实成交').toBe(100)
  })

  it('RV-5 有状态筛选时尊重筛选（筛 pending 就看 pending 的金额）', async () => {
    await mkOrder('completed', 100)
    await mkOrder('pending', 500)

    const res = await request(app).get('/api/admin/orders')
      .query({ status: 'pending' })
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(Number(res.body.data.stats.totalAmount), '筛选 pending 时金额就是 pending 的').toBe(500)
  })
})

describe('管理端改状态时的积分口径', () => {
  it('RV-6 待支付 → 已支付：补发购物积分（客户不能白少拿）', async () => {
    const { User, Order, PointTransaction } = models()
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13900004444'
    }))
    const order = await Order.create({
      order_no: `RV6${Date.now()}`,
      user_id: u.id,
      total_amount: 1000, total_amount_thb: 1000,
      currency_code: 'THB', payment_method: 'online', status: 'pending',
      contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
      exchange_rate: 1
    })

    const before = await PointTransaction.count({
      where: { order_id: order.id, type: 'earn_purchase' }
    })
    expect(before).toBe(0)

    const res = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipping' })
    expect(res.status).toBe(200)

    const after = await PointTransaction.count({
      where: { order_id: order.id, type: 'earn_purchase' }
    })
    expect(after, '状态改成"已收到钱"却没发积分 → 客户白少拿').toBe(1)

    // 再改一次状态不应重复发
    await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipped' })
    const again = await PointTransaction.count({
      where: { order_id: order.id, type: 'earn_purchase' }
    })
    expect(again, '不应重复发积分').toBe(1)
  })
})
