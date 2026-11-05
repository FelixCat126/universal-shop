/**
 * 订单超时清扫集成测试（orderTimeoutService.sweepExpiredPendingOrders）
 *   OT-1 超时的 pending 在线支付单：sweep 后订单+订单项删除、库存回补、返回处理数 1
 *   OT-2 未超时的 pending 在线支付单：sweep 后订单仍在、库存仍扣减
 *   OT-3 COD 单（创建即 shipping）：即使 backdate 也不受 sweep 影响
 *   OT-4 已支付（status≠pending）的超时单：复查后跳过，不删
 *   OT-5 促销快照随单清理（order_promotions 无 DB 级联，必须显式删）
 *   OT-6 合作方 pending_payment 超时单：删单 + 回补库存
 *   OT-7 合作方未超时单：sweep 不动它
 *   OT-8 超时阈值/间隔可配（env），非法值回退默认
 *   OT-9 测试环境不启动定时器（startOrderTimeoutSweeper 返回 null）
 *   OT-10 与支付确认并发：一方赢，另一方走幂等分支，不误删已支付单
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import {
  sweepExpiredPendingOrders,
  getPendingTimeoutMinutes,
  getSweepIntervalMs,
  startOrderTimeoutSweeper
} from '@server/services/orderTimeoutService.js'

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
    expect(processed.orders).toBe(1)

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
    expect(processed.orders).toBe(0)

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
    expect(processed.orders).toBe(0)

    const order = await Order.findByPk(orderId)
    expect(order).not.toBeNull()
    expect(order.status).toBe('shipping')
    expect(await OrderItem.count({ where: { order_id: orderId } })).toBe(1)

    await product.reload()
    expect(product.stock).toBe(8)
  }, 30000)

  it('OT-4 状态已不是 pending 的超时单：复查后跳过，不删不改', async () => {
    const { Order, OrderItem } = sequelize.models
    const { orderId, product } = await createOrder({ stock: 10, qty: 2 })

    // 模拟「支付确认先提交」：状态已变为 paid
    await Order.update({ status: 'paid' }, { where: { id: orderId } })
    await backdate15Min(orderId)

    const processed = await sweepExpiredPendingOrders()
    expect(processed.orders).toBe(0)

    // 订单、明细都还在，库存**不回补**（已支付的单不能退库存）
    const order = await Order.findByPk(orderId)
    expect(order).not.toBeNull()
    expect(order.status).toBe('paid')
    expect(await OrderItem.count({ where: { order_id: orderId } })).toBe(1)

    await product.reload()
    expect(product.stock).toBe(8)
  }, 30000)

  it('OT-5 促销快照随单清理（order_promotions 无 DB 级联）', async () => {
    const { Order, OrderPromotion } = sequelize.models
    const { orderId } = await createOrder({ stock: 10, qty: 1 })

    // 挂一条促销快照：order_promotions 没有 DB 级联，删单不会带走它
    await OrderPromotion.create({
      order_id: orderId,
      promotion_id: null,
      name: '测试快照',
      amount: 5
    })
    expect(await OrderPromotion.count({ where: { order_id: orderId } })).toBe(1)

    await backdate15Min(orderId)
    const processed = await sweepExpiredPendingOrders()
    expect(processed.orders).toBe(1)

    expect(await Order.findByPk(orderId)).toBeNull()
    // 促销快照必须一起清掉，否则会变成孤儿数据
    expect(await OrderPromotion.count({ where: { order_id: orderId } })).toBe(0)
  }, 30000)

  it('OT-6 合作方 pending_payment 超时单：删单 + 回补库存', async () => {
    const { PartnerOrder, PartnerOrderItem, Product, Partner } = sequelize.models
    const partner = await Partner.create(await TestDataFactory.createPartner())
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 20, price: 100, status: 'active' })
    )
    const order = await PartnerOrder.create(
      await TestDataFactory.createPartnerOrder(partner.id, { status: 'pending_payment' })
    )
    await PartnerOrderItem.create(
      await TestDataFactory.createPartnerOrderItem(order.id, product.id, { quantity: 3 })
    )
    // 模拟下单时已扣库存
    await product.update({ stock: product.stock - 3 })

    // 拨到超时区间
    await PartnerOrder.update(
      { created_at: new Date(Date.now() - 15 * 60 * 1000) },
      { where: { id: order.id } }
    )

    const processed = await sweepExpiredPendingOrders()
    expect(processed.partnerOrders).toBe(1)

    expect(await PartnerOrder.findByPk(order.id)).toBeNull()
    expect(await PartnerOrderItem.count({ where: { partner_order_id: order.id } })).toBe(0)

    await product.reload()
    expect(product.stock).toBe(20)
  }, 30000)

  it('OT-7 合作方未超时单：sweep 不动它', async () => {
    const { PartnerOrder, Product, Partner } = sequelize.models
    const partner = await Partner.create(await TestDataFactory.createPartner())
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 20, price: 100, status: 'active' })
    )
    const order = await PartnerOrder.create(
      await TestDataFactory.createPartnerOrder(partner.id, { status: 'pending_payment' })
    )
    await product.update({ stock: product.stock - 1 })

    const processed = await sweepExpiredPendingOrders()
    expect(processed.partnerOrders).toBe(0)

    expect(await PartnerOrder.findByPk(order.id)).not.toBeNull()
    await product.reload()
    expect(product.stock).toBe(19)
  }, 30000)

  it('OT-8 超时阈值/间隔可配：env 生效，非法值回退默认', async () => {
    const oldTimeout = process.env.ORDER_PENDING_TIMEOUT_MINUTES
    const oldInterval = process.env.ORDER_SWEEP_INTERVAL_MS
    try {
      delete process.env.ORDER_PENDING_TIMEOUT_MINUTES
      delete process.env.ORDER_SWEEP_INTERVAL_MS
      expect(getPendingTimeoutMinutes()).toBe(10)
      expect(getSweepIntervalMs()).toBe(60000)

      process.env.ORDER_PENDING_TIMEOUT_MINUTES = '3'
      process.env.ORDER_SWEEP_INTERVAL_MS = '1500'
      expect(getPendingTimeoutMinutes()).toBe(3)
      expect(getSweepIntervalMs()).toBe(1500)

      // 非法值（0 / 负数 / 非数字）必须回退默认，不能是 0（0 会把所有单都扫掉）
      process.env.ORDER_PENDING_TIMEOUT_MINUTES = '0'
      process.env.ORDER_SWEEP_INTERVAL_MS = 'abc'
      expect(getPendingTimeoutMinutes()).toBe(10)
      expect(getSweepIntervalMs()).toBe(60000)
    } finally {
      if (oldTimeout === undefined) delete process.env.ORDER_PENDING_TIMEOUT_MINUTES
      else process.env.ORDER_PENDING_TIMEOUT_MINUTES = oldTimeout
      if (oldInterval === undefined) delete process.env.ORDER_SWEEP_INTERVAL_MS
      else process.env.ORDER_SWEEP_INTERVAL_MS = oldInterval
    }
  })

  it('OT-9 测试环境不启动定时清扫器', () => {
    expect(startOrderTimeoutSweeper()).toBeNull()
  })

  it('OT-10 与支付确认并发：不会误删已支付单，也不会把库存退两次', async () => {
    const { Order, Product } = sequelize.models
    const { orderId, product } = await createOrder({ stock: 10, qty: 2 })
    await backdate15Min(orderId)

    // 并发：一边清扫，一边「确认支付」（条件 UPDATE status='pending'）
    const [sweepResult] = await Promise.all([
      sweepExpiredPendingOrders(),
      Order.update(
        { status: 'paid' },
        { where: { id: orderId, status: 'pending', payment_method: 'online' } }
      )
    ])

    const order = await Order.findByPk(orderId)
    await product.reload()

    // 只有两种自洽的结果：
    //   a) 清扫先赢 → 单被删、库存回到 10，确认支付的 UPDATE 影响 0 行
    //   b) 支付先赢 → 单保留且已支付、库存仍扣 2（不回补）
    if (order) {
      expect(order.status).toBe('paid')
      expect(product.stock).toBe(8)
      expect(sweepResult.orders).toBe(0)
    } else {
      expect(product.stock).toBe(10)
      expect(sweepResult.orders).toBe(1)
    }
  }, 30000)
})
