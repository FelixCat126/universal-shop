/**
 * 订单超时清扫集成测试（orderTimeoutService.sweepExpiredPendingOrders）
 *   OT-1 超时的 pending 在线支付单：sweep 后订单+订单项删除、库存回补、返回处理数 1
 *   OT-2 未超时的 pending 在线支付单：sweep 后订单仍在、库存仍扣减
 *   OT-3 COD 单（创建即 shipping）：即使 backdate 也不受 sweep 影响
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { sweepExpiredPendingOrders } from '@server/services/orderTimeoutService.js'

describe('订单超时清扫 orderTimeout', () => {
  let sequelize

  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    await seedSystemConfigBaseline()
  })

  // 走真实下单接口创建 online pending 单，返回 { orderId, product }
  async function createOrder ({ stock = 10, qty = 2, paymentMethod = 'online' } = {}) {
    const { User, Product } = sequelize.models
    const user = await User.create(await TestDataFactory.createUser())
    const token = TestHelpers.generateToken(user)
    const product = await Product.create(
      TestDataFactory.createProduct({ stock, price: 100, status: 'active' })
    )
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: qty }],
        contact_name: 'X',
        contact_phone: '13800000001',
        delivery_address: 'A',
        payment_method: paymentMethod
      })
    expect(res.status).toBe(201)
    return { orderId: res.body.data.order.id, product }
  }

  // 把订单 created_at 拨到 15 分钟前（超过默认 10 分钟超时阈值）
  async function backdate15Min (orderId) {
    const { Order } = sequelize.models
    await Order.update(
      { created_at: new Date(Date.now() - 15 * 60 * 1000) },
      { where: { id: orderId } }
    )
  }

  it('OT-1 超时的 pending 在线单：删除 + 回补库存，返回处理数 1', async () => {
    const { Order, OrderItem, PointTransaction } = sequelize.models
    const { orderId, product } = await createOrder({ stock: 10, qty: 2 })

    // 下单即扣库存
    await product.reload()
    expect(product.stock).toBe(8)

    await backdate15Min(orderId)

    const processed = await sweepExpiredPendingOrders()
    expect(processed).toBe(1)

    // 订单、订单项、积分流水均已清理
    expect(await Order.findByPk(orderId)).toBeNull()
    expect(await OrderItem.count({ where: { order_id: orderId } })).toBe(0)
    expect(await PointTransaction.count({ where: { order_id: orderId } })).toBe(0)

    // 库存回补
    await product.reload()
    expect(product.stock).toBe(10)
  }, 30000)

  it('OT-2 未超时的 pending 在线单：sweep 不动它', async () => {
    const { Order } = sequelize.models
    const { orderId, product } = await createOrder({ stock: 10, qty: 3 })

    await product.reload()
    expect(product.stock).toBe(7)

    const processed = await sweepExpiredPendingOrders()
    expect(processed).toBe(0)

    // 订单仍在、仍是 pending，库存仍扣减
    const order = await Order.findByPk(orderId)
    expect(order).not.toBeNull()
    expect(order.status).toBe('pending')

    await product.reload()
    expect(product.stock).toBe(7)
  }, 30000)

  it('OT-3 COD 单（创建即 shipping）：即使 backdate 也不受 sweep 影响', async () => {
    const { Order, OrderItem } = sequelize.models
    const { orderId, product } = await createOrder({ stock: 10, qty: 2, paymentMethod: 'cod' })

    // COD 单创建即 shipping，库存已扣
    await product.reload()
    expect(product.stock).toBe(8)

    // 即使把创建时间拨到超时区间，sweep 也只匹配 pending + online
    await backdate15Min(orderId)

    const processed = await sweepExpiredPendingOrders()
    expect(processed).toBe(0)

    const order = await Order.findByPk(orderId)
    expect(order).not.toBeNull()
    expect(order.status).toBe('shipping')
    expect(await OrderItem.count({ where: { order_id: orderId } })).toBe(1)

    await product.reload()
    expect(product.stock).toBe(8)
  }, 30000)
})
