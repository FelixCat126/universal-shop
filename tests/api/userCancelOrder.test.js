/**
 * 用户自助取消订单的闭环（第 45 轮）
 * ================================
 *
 * ## 原来是什么样
 *
 * 取消订单**只有管理端能做**（PUT /api/admin/orders/:id/status），
 * 客户侧没有入口 —— 于是一整条业务链断在起点：
 *
 *   取消订单 → 库存回补 ✓（只有管理员触发）
 *           → 积分退回（refund_cancel / revoke_cancel）✓（只有管理员触发）
 *           → 抵扣券退还 ✓（只有管理员触发）
 *
 * 客户想取消自己的订单只能联系运营；而且**看不到**自己的积分/券什么时候回来。
 *
 * ## 现在
 *
 * 新增 `POST /api/orders/:id/cancel`（只能取消自己的订单），
 * 与管理端**共用同一份取消实现**（performOrderCancel）→ 不会出现两边行为不一致。
 *
 * ## 用例
 *   UC-1 取消成功：订单变 cancelled，**库存回补**
 *   UC-2 取消成功：**购物积分收回**（余额回升，流水可查）
 *   UC-3 取消成功：**抵扣券退还**（status 回到 unused，订单号解绑）
 *   UC-4 不能取消别人的订单
 *   UC-5 已发货的订单不能取消
 *   UC-6 重复取消不会重复回补（幂等）
 *   UC-7 管理端的取消路径仍然正常（共用实现没被改坏）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let user
let token
let adminToken
let product
let order

beforeEach(async () => {
  await TestDatabase.clearAllData()
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900008888'
  }))
  token = TestHelpers.generateToken(user)
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)

  product = await models().Product.create(TestDataFactory.createProduct({
    name: '取消测试商品', price: 100, stock: 10, status: 'active'
  }))
})

/** 建一单（默认 shipping = 备货中） */
async function makeOrder ({ status = 'shipping', quantity = 2, price = 100 } = {}) {
  const o = await models().Order.create({
    order_no: `UC${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: price * quantity,
    total_amount_thb: price * quantity,
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    contact_name: '取消测试',
    contact_phone: '13800138000',
    delivery_address: '某路 8 号',
    exchange_rate: 1
  })
  await models().OrderItem.create({
    order_id: o.id,
    product_id: product.id,
    quantity,
    price,
    original_price: price,
    product_name_zh: '取消测试商品'
  })
  return o
}

describe('用户自助取消订单', () => {
  it('UC-1 取消成功：订单变 cancelled，库存回补', async () => {
    order = await makeOrder({ quantity: 2 })
    const before = (await models().Product.findByPk(product.id, { raw: true })).stock

    const res = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status, `取消应当成功：${JSON.stringify(res.body)}`).toBe(200)

    const fresh = await models().Order.findByPk(order.id, { raw: true })
    expect(fresh.status).toBe('cancelled')

    const after = (await models().Product.findByPk(product.id, { raw: true })).stock
    expect(after, '取消后库存应回补').toBe(before + 2)
  })

  it('UC-2 取消成功：购物积分收回（余额回升 + 流水可查）', async () => {
    order = await makeOrder({ quantity: 1 })
    // 下单时发了 5 分购物积分（模拟 earn_purchase 流水）
    await models().UserPointBalance.create({ user_id: user.id, balance: 5, archived_delta: 0 })
    await models().PointTransaction.create({
      user_id: user.id,
      order_id: order.id,
      type: 'earn_purchase',
      delta: 5,
      balance_after: 5,
      description: '购物赠送积分'
    })

    const res = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const balance = await models().UserPointBalance.findOne({ where: { user_id: user.id }, raw: true })
    expect(Number(balance.balance), '取消后购物积分应被收回').toBe(0)

    const revoke = await models().PointTransaction.findOne({
      where: { user_id: user.id, type: 'revoke_cancel' },
      raw: true
    })
    expect(revoke, '应有一条收回积分的流水（客户在积分明细里看得到）').toBeTruthy()
  })

  it('UC-3 取消成功：抵扣券退还', async () => {
    order = await makeOrder({ quantity: 1 })
    const { CouponTemplate, UserCoupon } = models()
    const tpl = await CouponTemplate.create({
      name: '取消测试券',
      amount: 10,
      min_spend: 0,
      status: 'active'
    })
    const coupon = await UserCoupon.create({
      template_id: tpl.id,
      user_id: user.id,
      code: `UCCODE${Date.now()}`,
      status: 'used',
      used_by_order_id: order.id,
      used_at: new Date()
    })

    const res = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const fresh = await UserCoupon.findByPk(coupon.id, { raw: true })
    expect(fresh.status, '券应退回未使用').toBe('unused')
    expect(fresh.used_by_order_id, '券不应再挂在订单上').toBeNull()
  })

  it('UC-4 不能取消别人的订单', async () => {
    order = await makeOrder()
    const other = await models().User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13900009999'
    }))
    const otherToken = TestHelpers.generateToken(other)

    const res = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${otherToken}`)
    expect(res.status).toBe(404)

    const fresh = await models().Order.findByPk(order.id, { raw: true })
    expect(fresh.status, '别人的订单不该被取消').toBe('shipping')
  })

  it('UC-5 已发货的订单不能取消', async () => {
    order = await makeOrder({ status: 'shipped' })
    const res = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)

    const fresh = await models().Order.findByPk(order.id, { raw: true })
    expect(fresh.status).toBe('shipped')
  })

  it('UC-6 重复取消不会重复回补（幂等）', async () => {
    order = await makeOrder({ quantity: 2 })
    const before = (await models().Product.findByPk(product.id, { raw: true })).stock

    const first = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(first.status).toBe(200)

    const second = await request(app).post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(second.status, '第二次取消应当被拒').toBe(400)

    const after = (await models().Product.findByPk(product.id, { raw: true })).stock
    expect(after, '库存只能回补一次').toBe(before + 2)
  })

  it('UC-7 管理端的取消路径仍然正常（共用实现没被改坏）', async () => {
    order = await makeOrder({ quantity: 3 })
    const before = (await models().Product.findByPk(product.id, { raw: true })).stock

    const res = await request(app).put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })
    expect(res.status).toBe(200)

    const fresh = await models().Order.findByPk(order.id, { raw: true })
    expect(fresh.status).toBe('cancelled')
    const after = (await models().Product.findByPk(product.id, { raw: true })).stock
    expect(after, '管理端取消同样要回补库存').toBe(before + 3)
  })
})
