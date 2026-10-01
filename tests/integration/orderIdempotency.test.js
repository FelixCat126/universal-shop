/**
 * 订单幂等键 client_order_key 集成测试：
 *   OI-1 同用户同 key 顺序双发 → 两响应同 order.id、第二次 deduplicated=true、库存只扣一次
 *   OI-2 同用户不带 key 双发 → 两张订单（不带幂等键维持现状，逐次成单）
 *   OI-3 不同用户同 key → 各自成单（幂等唯一维度是 (user_id, client_order_key)）
 *
 * 注：测试库由 TestDatabase sync 建表，不含生产库的 (user_id, client_order_key)
 * 部分唯一索引；顺序双发由控制器幂等预检兜底，并发同 key 的索引兜底只在生产库生效。
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

async function userWithToken () {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const user = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    })
  )
  return { user, token: TestHelpers.generateToken(user) }
}

const BODY = {
  contact_name: '收货人',
  contact_phone: '+8613900000777',
  delivery_address: '某街区 1 号'
}

describe('订单幂等键 client_order_key', () => {
  it('OI-1 同 key 双发 → 返回同一张订单、库存只扣一次', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product, Order } = sequelize.models
    const { user, token } = await userWithToken()
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 10, price: 100, status: 'active' })
    )

    const payload = {
      ...BODY,
      items: [{ product_id: product.id, quantity: 2 }],
      payment_method: 'cod',
      client_order_key: 'oi-1-same-key'
    }

    const r1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
    expect(r1.status).toBe(201)
    expect(r1.body.data.deduplicated).toBeFalsy()

    const r2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
    expect(r2.status).toBe(201)
    // 幂等命中标记 + 返回的是同一张订单
    expect(r2.body.data.deduplicated).toBe(true)
    expect(r2.body.data.order.id).toBe(r1.body.data.order.id)

    // 库存只扣了一次（10 - 2 = 8），订单只有一张
    await product.reload()
    expect(product.stock).toBe(8)
    const orderCount = await Order.count({ where: { user_id: user.id } })
    expect(orderCount).toBe(1)
  }, 60000)

  it('OI-2 不带 key 双发 → 两张订单（现状保留）', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product, Order } = sequelize.models
    const { user, token } = await userWithToken()
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 10, price: 100, status: 'active' })
    )

    const payload = {
      ...BODY,
      items: [{ product_id: product.id, quantity: 1 }],
      payment_method: 'cod'
    }

    const r1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
    const r2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    // 不带幂等键：每次提交各自成单（既有行为不变）
    expect(r2.body.data.order.id).not.toBe(r1.body.data.order.id)

    await product.reload()
    expect(product.stock).toBe(8)
    const orderCount = await Order.count({ where: { user_id: user.id } })
    expect(orderCount).toBe(2)
  }, 60000)

  it('OI-3 不同用户同 key → 各自成单', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product, Order } = sequelize.models
    const { user: u1, token: t1 } = await userWithToken()
    const { user: u2, token: t2 } = await userWithToken()
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 10, price: 100, status: 'active' })
    )

    const payload = {
      ...BODY,
      items: [{ product_id: product.id, quantity: 1 }],
      payment_method: 'cod',
      client_order_key: 'oi-3-shared-key'
    }

    const r1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${t1}`)
      .send(payload)
    const r2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${t2}`)
      .send(payload)
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    // 幂等键的唯一维度是 (user_id, key)：不同用户互不去重
    expect(r1.body.data.deduplicated).toBeFalsy()
    expect(r2.body.data.deduplicated).toBeFalsy()
    expect(r2.body.data.order.id).not.toBe(r1.body.data.order.id)

    await product.reload()
    expect(product.stock).toBe(8)
    expect(await Order.count({ where: { user_id: u1.id } })).toBe(1)
    expect(await Order.count({ where: { user_id: u2.id } })).toBe(1)
  }, 60000)
})
