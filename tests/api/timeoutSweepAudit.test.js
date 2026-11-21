/**
 * 超时未支付订单被清扫时的**审计留痕**（第 47 轮）
 * ==============================================
 *
 * ## 为什么要有这条
 *
 * 客户扫码付款后如果没点「完成支付」，这单 10 分钟后会被自动清扫（物理删除）。
 * 也就是说：**钱可能已经到了商户账上，系统里却没有这单**。
 *
 * 之前删得干干净净 —— 运营事后连"有没有过这单"都查不到
 * （连订单号都没有），只能翻银行流水按金额猜。
 *
 * 第 47 轮补上：删单**之前**先写一条系统审计
 * （订单号 + 金额 + 下单时间 + 被清时间 + 原因），
 * 运营在「行为审计」页按事件就能筛出来，与银行流水对得上 ✓。
 *
 * （根治还需要支付回调/自动对账，那超出本项目范围 —— 但至少**留得下凭据**。）
 *
 * ## 用例
 *   SA-1 零售单被清扫后，审计里能查到（订单号/金额/原因），且与删单在**同一事务**
 *   SA-2 合作方单被清扫后，同样留痕
 *   SA-3 没被清扫的单（状态不是 pending）不会留下"被清扫"的假记录
 */
import { describe, it, expect, beforeEach } from 'vitest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { sweepExpiredPendingOrders } from '@server/services/orderTimeoutService.js'

const models = () => TestDatabase.getSequelize().models

/** 一笔"已经超时"的在线待支付订单 */
async function makeStaleOrder (overrides = {}) {
  const { Order, OrderItem, Product } = models()
  const user = await models().User.create(await TestDataFactory.createUser({
    nickname: '超时客户', phone: '812345690', country_code: '+66'
  }))
  const product = await Product.create(TestDataFactory.createProduct({
    name: '超时商品', price: 100, stock: 10
  }))
  const order = await Order.create({
    order_no: `SA${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'online',
    status: 'pending',
    contact_name: '超时客户',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1,
    // 2 小时前下单（默认超时 10 分钟 → 一定会被扫到）
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
    ...overrides
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 1,
    price: 100,
    original_price: 100
  })
  return { order, product, user }
}

describe('超时清扫的审计留痕', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
  })

  it('SA-1 零售单被清扫 → 审计里查得到订单号与金额', async () => {
    const { order, product } = await makeStaleOrder()
    const stockBefore = (await models().Product.findByPk(product.id, { raw: true })).stock

    const result = await sweepExpiredPendingOrders()
    expect(result.orders, '这一单应该被清扫').toBeGreaterThanOrEqual(1)

    // 单确实被删了
    const gone = await models().Order.findByPk(order.id)
    expect(gone, '超时的待支付订单会被物理删除（现状不变）').toBeFalsy()

    // 但审计留下来了
    const { AuditLog } = models()
    const log = await AuditLog.findOne({
      where: { event: 'order.timeout.swept', resource_id: String(order.id) },
      raw: true
    })
    expect(log, '删单前必须留一条审计（否则钱到了单没了、连凭据都没有）').toBeTruthy()
    expect(log.detail?.order_no).toBe(order.order_no)
    expect(Number(log.detail?.total_amount)).toBe(100)
    expect(log.detail?.reason).toMatch(/超时/)
    expect(log.actor_type).toBe('system')

    // 库存照常回补
    const stockAfter = (await models().Product.findByPk(product.id, { raw: true })).stock
    expect(stockAfter).toBe(stockBefore + 1)
  })

  it('SA-2 合作方单被清扫 → 同样留痕', async () => {
    const { Partner, PartnerOrder, PartnerOrderItem, Product } = models()
    const partner = await Partner.create({
      login: 'sa_partner',
      password: 'SaPwd#1234',
      display_name: 'SA 合作方',
      account_kind: 'dealer',
      is_active: true
    })
    const product = await Product.create(TestDataFactory.createProduct({
      name: 'SA 商品', price: 100, stock: 10
    }))
    const order = await PartnerOrder.create({
      order_no: `SAP${Date.now()}`,
      partner_id: partner.id,
      total_amount_thb: 100,
      currency_code: 'THB',
      payment_method: 'online',
      status: 'pending_payment',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000)
    })
    await PartnerOrderItem.create({
      partner_order_id: order.id,
      product_id: product.id,
      quantity: 1,
      base_unit_thb: 100,
      unit_price_thb: 100,
      line_total_thb: 100,
      partner_discount_percent_snapshot: 0,
      product_name_snapshot: 'SA 商品'
    })

    const result = await sweepExpiredPendingOrders()
    expect(result.partnerOrders, '这一单应该被清扫').toBeGreaterThanOrEqual(1)

    const { AuditLog } = models()
    const log = await AuditLog.findOne({
      where: { event: 'partner_order.timeout.swept', resource_id: String(order.id) },
      raw: true
    })
    expect(log, '合作方单被清扫也要留痕').toBeTruthy()
    expect(log.detail?.order_no).toBe(order.order_no)
  })

  it('SA-3 不是 pending 的单不会被清扫，也不会留下假记录', async () => {
    const { order } = await makeStaleOrder({ status: 'shipping' })
    await sweepExpiredPendingOrders()

    const still = await models().Order.findByPk(order.id)
    expect(still, '非 pending 的单不该被清').toBeTruthy()

    const { AuditLog } = models()
    const log = await AuditLog.findOne({
      where: { event: 'order.timeout.swept', resource_id: String(order.id) },
      raw: true
    })
    expect(log, '没被清扫的单不该有"被清扫"记录').toBeFalsy()
  })
})
