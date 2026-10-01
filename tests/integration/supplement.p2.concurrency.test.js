/**
 * P2 真实并发（4 用例）
 *
 * 跑现有的 PG 并发安全 guarantee
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers, withHttpServer } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'
import { clearResponseCache } from '@server/utils/responseCache.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
  _resetLoginGuardForTests()
  clearResponseCache()
})

async function makeUser (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const data = await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  })
  return User.create(data)
}

async function activeProduct (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Product, ProductCategory } = sequelize.models
  const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
  return Product.create(
    TestDataFactory.createProduct({
      stock: 50, status: 'active', price: 100, category_id: cat.id, ...overrides
    })
  )
}

describe('P2concurrency.partnerOversell', () => {
  it('P2C-1 合作方下单并发超卖（20 并发 / 库存 5）', async () => {
    await seedSystemConfigBaseline()
    const { partner, address, token } = await TestHelpers.createPartnerWithAddress({
      discount_percent: 0
    })
    const product = await activeProduct({ stock: 5, price: 100, discount: null })

    const N = 20
    const promises = []
    for (let i = 0; i < N; i++) {
      promises.push(
        request(app).post('/api/partner/orders')
          .set('Authorization', `Bearer ${token}`)
          .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
      )
    }
    const results = await Promise.all(promises)
    const ok = results.filter((r) => r.status === 201).length
    const fail = results.filter((r) => r.status !== 201).length
    expect(ok).toBeLessThanOrEqual(5)
    expect(ok + fail).toBe(N)

    const sequelize = TestDatabase.getSequelize()
    const { Product, PartnerOrder } = sequelize.models
    const fresh = await Product.findByPk(product.id)
    expect(fresh.stock).toBeGreaterThanOrEqual(0)
    const orderCount = await PartnerOrder.count({ where: { partner_id: partner.id } })
    expect(orderCount).toBe(ok)
  })
})

describe('P2concurrency.pointsConcurrent', () => {
  it('P2C-2 积分并发扣减（余额 100 / 并发 5 笔 30 积分）', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const product = await activeProduct({ stock: 1000, price: 10, points: 30 })

    // 充值 100
    await TestHelpers.topUpUserPoints(user, 100)

    const N = 5
    const promises = []
    for (let i = 0; i < N; i++) {
      promises.push(
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send({
            contact_name: 'X',
            contact_phone: '13800000001',
            delivery_address: 'A',
            payment_method: 'points',
            items: [{ product_id: product.id, quantity: 1 }]
          })
      )
    }
    const results = await Promise.all(promises)
    const ok = results.filter((r) => r.status === 201).length
    // 100 积分余额，每次扣 30（商品 points=30）+ 30 + 30 + 30 = 120 → 最多 3 笔
    expect(ok).toBeLessThanOrEqual(3)
    const sequelize = TestDatabase.getSequelize()
    const { UserPointBalance } = sequelize.models
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(bal.balance).toBeGreaterThanOrEqual(0)
    expect(bal.balance).toBeLessThanOrEqual(100)
  })
})

describe('P2concurrency.orderNoUnique', () => {
  it('P2C-3 订单号唯一性（30 并发订单）', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const product = await activeProduct({ stock: 1000, price: 10 })

    const N = 30
    // 单实例 server 跑 30 并发：避免 30 个 ephemeral server 并发监听/销毁的传输层抖动
    const results = await withHttpServer(app, async (base) => {
      const promises = []
      for (let i = 0; i < N; i++) {
        promises.push(
          request(base).post('/api/orders')
            .set('Authorization', `Bearer ${token}`)
            .send({
              contact_name: 'X',
              contact_phone: '13800000001',
              delivery_address: 'A',
              items: [{ product_id: product.id, quantity: 1 }]
            })
        )
      }
      return Promise.all(promises)
    })
    const ok = results.filter((r) => r.status === 201).length
    expect(ok).toBe(N) // 库存 1000 够 30 笔

    const sequelize = TestDatabase.getSequelize()
    const { Order } = sequelize.models
    const orders = await Order.findAll({ where: { user_id: user.id } })
    const orderNos = orders.map((o) => o.order_no)
    const unique = new Set(orderNos)
    expect(unique.size).toBe(ok) // 全部唯一
  })
})

describe('P2concurrency.adjustStockAtomic', () => {
  it('P2C-4 多 admin 同时改同一库存（原子累加）', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Administrator } = sequelize.models
    const admin1 = await Administrator.create({
      username: 'admin1',
      password: 'Abcd1234',
      role: 'admin',
      is_active: true
    })
    const admin2 = await Administrator.create({
      username: 'admin2',
      password: 'Abcd1234',
      role: 'admin',
      is_active: true
    })
    const t1 = TestHelpers.generateAdminToken(admin1)
    const t2 = TestHelpers.generateAdminToken(admin2)
    const product = await activeProduct({ stock: 100 })

    // 两个 admin 同时 add 10
    await Promise.all([
      request(app).post(`/api/products/${product.id}/stock`)
        .set('Authorization', `Bearer ${t1}`)
        .send({ type: 'add', quantity: 10 }),
      request(app).post(`/api/products/${product.id}/stock`)
        .set('Authorization', `Bearer ${t2}`)
        .send({ type: 'add', quantity: 10 })
    ])

    const { Product } = TestDatabase.getSequelize().models
    const fresh = await Product.findByPk(product.id)
    expect(fresh.stock).toBe(120)
  })
})
