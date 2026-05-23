/**
 * P1 用户面 — 在线支付确认流（3 用例）
 *   OF-1 confirmOnlinePayment happy → 200 + status=shipping + 积分按件发放
 *   OF-2 双击重复 confirm → 200 幂等（不重复发积分，不变状态）
 *   OF-3 跨用户访问别人订单 confirm → 404
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

async function userWithToken (suffix = '') {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const u = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}${suffix}`.slice(0, 11)
    })
  )
  return { user: u, token: TestHelpers.generateToken(u) }
}

async function pendingOnlineOrder (user) {
  const sequelize = TestDatabase.getSequelize()
  const { Order, OrderItem, Product } = sequelize.models
  const product = await Product.create(
    TestDataFactory.createProduct({ stock: 5, price: 100, status: 'active' })
  )
  const order = await Order.create({
    order_no: `OF${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 200,
    total_amount_thb: 200,
    currency_code: 'THB',
    payment_method: 'online',
    status: 'pending',
    contact_name: 'X',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 2,
    price: 100,
    original_price: 100,
    product_name_zh: product.name
  })
  return { order, product }
}

describe('P1.portal.order.flow', () => {
  it('OF-1 confirmOnlinePayment happy → 200 + shipping + 发积分', async () => {
    const { user, token } = await userWithToken()
    const { order } = await pendingOnlineOrder(user)

    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Order, UserPointBalance } = sequelize.models
    const fresh = await Order.findByPk(order.id)
    expect(fresh.status).toBe('shipping')
    expect(fresh.online_paid_at).toBeTruthy()

    const bal = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(bal && Number(bal.balance)).toBe(2)
  })

  it('OF-2 双击重复 confirm → 200 幂等', async () => {
    const { user, token } = await userWithToken()
    const { order } = await pendingOnlineOrder(user)

    const r1 = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(r1.status).toBe(200)

    const r2 = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(r2.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { UserPointBalance } = sequelize.models
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(bal.balance)).toBe(2) // 不重复
  })

  it('OF-3 跨用户访问别人订单 confirm → 404', async () => {
    const { user: owner } = await userWithToken('1')
    const { token: other } = await userWithToken('2')
    const { order } = await pendingOnlineOrder(owner)

    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${other}`)
    expect(res.status).toBe(404)
  })
})
