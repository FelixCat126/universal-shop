/**
 * 订单：竞态甄别 / 推荐人 / 取消时的积分护栏
 *
 * 这三条是订单控制器里**最容易出事**又**最难测**的分支：
 *
 *   OR-1 确认支付时 affected=0（预读与 UPDATE 之间订单被并发删了）→ 404
 *   OR-2 affected=0 且并发确认已生效 → 幂等成功（不能谎报失败）
 *   OR-3 affected=0 且状态被改走 → 409
 *   OR-4 订单列表带上推荐人信息（批量查，不是 N+1）
 *   OR-5 取消订单时"已发放的积分已被花掉" → 拒绝取消（不能白给积分）
 *
 * OR-1~3 用**故障注入**（spy 掉条件 UPDATE 的返回值）模拟竞态窗口 ——
 * 真去制造并发窗口既慢又不稳定。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let user
let token
let adminToken
let product

beforeEach(async () => {
  vi.restoreAllMocks()
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory, Administrator } = models
  const cat = await ProductCategory.create({ name: '竞态测试分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '竞态测试商品', price: 100, stock: 100, category_id: cat.id
  }))
  user = await models.User.create(await TestDataFactory.createUser({
    nickname: '竞态测试用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: `race${Date.now()}@example.com`
  }))
  token = TestHelpers.generateToken(user)
  const admin = await Administrator.create({
    username: `race_admin_${Date.now()}`,
    password: 'RacePwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

/** 造一张待支付的在线订单 */
async function makeOnlineOrder (extra = {}) {
  const { Order, OrderItem } = TestDatabase.getSequelize().models
  const order = await Order.create({
    order_no: `RC${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    discount_amount: 0,
    currency_code: 'THB',
    payment_method: 'online',
    status: 'pending',
    exchange_rate: 1,
    ...extra
  })
  await OrderItem.create({
    order_id: order.id, product_id: product.id, quantity: 1,
    price: 100, original_price: 100, product_name_zh: product.name
  })
  return order
}

describe('确认支付的竞态甄别', () => {
  it('OR-1 affected=0 且订单已被并发删掉 → 404（不能谎报"已确认"）', async () => {
    const order = await makeOnlineOrder()
    const { Order } = TestDatabase.getSequelize().models

    // 模拟竞态：条件 UPDATE 没命中（订单已被删）→ 重读时也读不到
    vi.spyOn(Order, 'update').mockResolvedValue([0])
    vi.spyOn(Order, 'findByPk').mockResolvedValue(null)

    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(404)
  })

  it('OR-2 affected=0 但并发确认已生效（online_paid_at 已置位）→ 幂等成功', async () => {
    const order = await makeOnlineOrder()
    const { Order } = TestDatabase.getSequelize().models

    vi.spyOn(Order, 'update').mockResolvedValue([0])
    // 重读时发现已被并发确认过
    vi.spyOn(Order, 'findByPk').mockImplementation(async () => {
      const fresh = await Order.findOne({ where: { id: order.id } })
      if (fresh) fresh.dataValues.online_paid_at = new Date()
      return fresh
    })

    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/支付已确认/)
  })

  it('OR-3 affected=0 且状态被改走 → 409', async () => {
    const order = await makeOnlineOrder()
    const { Order } = TestDatabase.getSequelize().models

    vi.spyOn(Order, 'update').mockResolvedValue([0])
    // 重读时订单还在、但没付过款（状态已被并发改走）
    vi.spyOn(Order, 'findByPk').mockImplementation(async () => {
      const fresh = await Order.findOne({ where: { id: order.id } })
      if (fresh) fresh.dataValues.status = 'cancelled'
      return fresh
    })

    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(409)
  })
})

describe('订单列表的推荐人信息', () => {
  it('OR-4 列表里带上推荐人（批量查，不是每单一次）', async () => {
    const models = TestDatabase.getSequelize().models
    const { Order, OrderItem, User } = models

    // 推荐人
    const referrer = await User.create(await TestDataFactory.createUser({
      nickname: '推荐人甲',
      country_code: '+86',
      phone: `137${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      email: `ref${Date.now()}@example.com`
    }))
    // 被推荐的用户
    const referred = await User.create(await TestDataFactory.createUser({
      nickname: '被推荐用户',
      country_code: '+86',
      phone: `136${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      email: `refd${Date.now()}@example.com`,
      referred_by_code: referrer.referral_code
    }))

    const order = await Order.create({
      order_no: `REF${Date.now()}`,
      user_id: referred.id,
      total_amount: 100, total_amount_thb: 100, discount_amount: 0,
      currency_code: 'THB', payment_method: 'cod', status: 'completed', exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 1,
      price: 100, original_price: 100, product_name_zh: product.name
    })

    const res = await request(app)
      .get('/api/admin/orders').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const found = res.body.data.orders.find(o => o.id === order.id)
    expect(found).toBeTruthy()
    expect(found.user.referrer).toBeTruthy()
    expect(found.user.referrer.nickname).toBe('推荐人甲')
  })
})

describe('取消订单的积分护栏', () => {
  it('OR-5 订单的购物积分已被花掉 → 拒绝取消（不能白给积分）', async () => {
    const models = TestDatabase.getSequelize().models
    const { Order, OrderItem, PointTransaction, UserPointBalance } = models

    const order = await Order.create({
      order_no: `PNT${Date.now()}`,
      user_id: user.id,
      total_amount: 100, total_amount_thb: 100, discount_amount: 0,
      // paid 才可取消（completed/cancelled 是终态，状态机会先拦下来）
      currency_code: 'THB', payment_method: 'cod', status: 'paid', exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 1,
      price: 100, original_price: 100, product_name_zh: product.name
    })
    // 这单发放过 100 积分
    await PointTransaction.create({
      user_id: user.id,
      order_id: order.id,
      type: 'earn_purchase',
      delta: 100,
      balance_after: 100,
      description: '测试发放'
    })
    // 但积分已经被花光了（余额 0）→ 取消时收回会变成"白给"
    await UserPointBalance.upsert({
      user_id: user.id,
      balance: 0,
      total_earned: 100,
      total_spent: 100
    })

    const res = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/积分已被使用/)
  })
})
