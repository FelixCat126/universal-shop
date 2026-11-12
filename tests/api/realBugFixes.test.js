/**
 * 抓真问题这一轮的高危修复回归
 *
 * 这一批全是**静默出错**的故障：不报错、不提示、直接把库改坏或让防线失效。
 *
 *   RB-1 删除订单：积分已被花掉的订单不许删（否则用户白拿积分）
 *   RB-2 合作方取消订单：软删商品的库存也要回补（paranoid:false）
 *   RB-3 超时清扫回补库存：同样要 paranoid:false
 *   RB-4 MemoryStore.increment 并发不丢更新（限流不能形同虚设）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { injectFault, restoreFaults } from '../helpers/faultInjection.js'

const models = () => TestDatabase.getSequelize().models

let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
})

afterEach(() => { restoreFaults() })

/** 造一张带商品的订单 */
async function makeOrder (status = 'pending', opts = {}) {
  const { User, Product, Order, OrderItem } = models()
  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  const product = await Product.create(TestDataFactory.createProduct({
    stock: opts.stock ?? 10,
    price: 50
  }))
  const quantity = opts.quantity ?? 2
  const order = await Order.create({
    order_no: `RB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 50 * quantity,
    total_amount_thb: 50 * quantity,
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id, product_id: product.id, quantity,
    price: 50, original_price: 50, product_name_zh: product.name
  })
  return { user, product, order }
}

describe('删除订单的积分护栏', () => {
  it('RB-1 积分已被花掉的订单 → 400，不删（否则用户白拿积分）', async () => {
    const { user, order } = await makeOrder('pending')
    const { UserPointBalance, PointTransaction } = models()

    // 该单已发放 100 购物积分，但用户已把积分花光
    await PointTransaction.create({
      user_id: user.id,
      order_id: order.id,
      type: 'earn_purchase',
      delta: 100,
      balance_after: 100,
      description: '测试发放'
    })
    await UserPointBalance.upsert({
      user_id: user.id, balance: 0, total_earned: 100, total_spent: 100
    })

    const res = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status, `不该删掉：${JSON.stringify(res.body)}`).toBe(400)
    expect(res.body.message).toMatch(/积分/)

    // 订单还在，积分流水也还在
    const { Order } = models()
    expect(await Order.findByPk(order.id)).toBeTruthy()
    expect(await PointTransaction.count({ where: { order_id: order.id } })).toBe(1)
  })

  it('RB-1b 积分没被花掉的订单 → 照常删除', async () => {
    const { user, order } = await makeOrder('pending')
    const { UserPointBalance, PointTransaction } = models()

    await PointTransaction.create({
      user_id: user.id, order_id: order.id, type: 'earn_purchase',
      delta: 100, balance_after: 100, description: '测试发放'
    })
    await UserPointBalance.upsert({
      user_id: user.id, balance: 100, total_earned: 100, total_spent: 0
    })

    const res = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const { Order } = models()
    expect(await Order.findByPk(order.id)).toBeFalsy()
  })
})

describe('库存回补要算上软删商品', () => {
  it('RB-2 合作方取消订单 → 软删商品的库存被回补', async () => {
    const { Product, PartnerOrder, PartnerOrderItem } = models()

    const product = await Product.create(TestDataFactory.createProduct({
      stock: 5, price: 50, status: 'active'
    }))
    const partner = await models().Partner.create({
      login: 'rb_partner_1',
      password: 'Partner#2026',
      display_name: 'RB 合作方',
      is_active: true
    })
    const order = await PartnerOrder.create({
      partner_id: partner.id,
      partner_address_id: null,
      order_no: `RBP${Date.now()}`,
      status: 'submitted',
      total_amount: 100, total_amount_thb: 100,
      currency_code: 'THB', payment_method: 'cod'
    })
    await PartnerOrderItem.create({
      partner_order_id: order.id, product_id: product.id, quantity: 3,
      base_unit_thb: 50, unit_price_thb: 50, line_total_thb: 150,
      partner_discount_percent_snapshot: 0, product_name_snapshot: product.name
    })

    // 商品被软删（管理端下架/删除走的是软删）
    await product.destroy()

    const res = await request(app)
      .put(`/api/admin/partner-orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })

    expect(res.status).toBe(200)

    // ⚠️ paranoid 过滤会让这条 UPDATE 影响 0 行且**不报错** → 库存永久少扣 3
    const fresh = await Product.findByPk(product.id, { paranoid: false })
    expect(Number(fresh.stock), '软删商品的库存也必须回补').toBe(8)
  })
})

describe('MemoryStore 计数器', () => {
  it('RB-4 并发 increment 不丢更新（限流不能形同虚设）', async () => {
    const { createSharedStore } = await import('@server/utils/sharedState.js')
    const state = createSharedStore('rb-test')

    const results = await Promise.all([
      state.increment('k', 60_000),
      state.increment('k', 60_000),
      state.increment('k', 60_000),
      state.increment('k', 60_000),
      state.increment('k', 60_000)
    ])

    expect(results).toEqual([1, 2, 3, 4, 5])
    expect(await state.get('k')).toBe(5)
  })

  it('RB-4b 过期后重新计数从 1 开始', async () => {
    const { createSharedStore } = await import('@server/utils/sharedState.js')
    const state = createSharedStore('rb-test2')

    expect(await state.increment('k', 50)).toBe(1)
    await new Promise(r => setTimeout(r, 80))
    expect(await state.increment('k', 60_000)).toBe(1)
  })
})
