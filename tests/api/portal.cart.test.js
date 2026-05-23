/**
 * P1 用户面 — 购物车（7 用例）
 *   CT-1 匿名加购 → 200 + 响应头 Session-ID
 *   CT-2 登录加购 → 200，DB 落库以 user_id 关联
 *   CT-3 GET 拉购物车 → 200 数组
 *   CT-4 重复加同一 product_id → quantity 累加（库存允许）
 *   CT-5 PUT 更新数量 → 200
 *   CT-6 DELETE 单项 → 200
 *   CT-7 DELETE 全部清空 → 200
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
  const u = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    })
  )
  return { user: u, token: TestHelpers.generateToken(u) }
}

async function activeProduct (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Product } = sequelize.models
  return Product.create(TestDataFactory.createProduct({ stock: 50, status: 'active', ...overrides }))
}

describe('P1.portal.cart', () => {
  it('CT-1 匿名加购 → 200 + 响应头 Session-ID', async () => {
    const p = await activeProduct()
    const res = await request(app).post('/api/cart').send({ product_id: p.id, quantity: 1 })
    expect(res.status).toBe(200)
    expect(res.headers['session-id']).toBeTruthy()
    expect(res.body.success).toBe(true)
  })

  it('CT-2 登录加购 → 200，DB 落库 user_id', async () => {
    const { user, token } = await userWithToken()
    const p = await activeProduct()
    const res = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 2 })
    expect(res.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Cart } = sequelize.models
    const row = await Cart.findOne({ where: { user_id: user.id, product_id: p.id } })
    expect(row).toBeTruthy()
    expect(row.quantity).toBe(2)
  })

  it('CT-3 GET 拉购物车 → 200 数组', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 1 })
    const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBe(1)
    expect(res.body.data[0].product.id).toBe(p.id)
  })

  it('CT-4 重复加同一 product_id → quantity 累加', async () => {
    const { user, token } = await userWithToken()
    const p = await activeProduct()
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 1 })
    const r2 = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 3 })
    expect(r2.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Cart } = sequelize.models
    const row = await Cart.findOne({ where: { user_id: user.id, product_id: p.id } })
    expect(row.quantity).toBe(4)
  })

  it('CT-5 PUT 更新数量 → 200', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const add = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 1 })
    const cartId = add.body.data.id
    const res = await request(app)
      .put(`/api/cart/${cartId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
    expect(res.status).toBe(200)
    expect(Number(res.body.data.quantity)).toBe(5)
  })

  it('CT-6 DELETE 单项 → 200', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const add = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 1 })
    const res = await request(app)
      .delete(`/api/cart/${add.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('CT-7 DELETE 全部清空 → 200', async () => {
    const { user, token } = await userWithToken()
    const p1 = await activeProduct()
    const p2 = await activeProduct()
    await request(app).post('/api/cart').set('Authorization', `Bearer ${token}`).send({ product_id: p1.id, quantity: 1 })
    await request(app).post('/api/cart').set('Authorization', `Bearer ${token}`).send({ product_id: p2.id, quantity: 1 })

    const res = await request(app).delete('/api/cart').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Cart } = sequelize.models
    const remaining = await Cart.count({ where: { user_id: user.id } })
    expect(remaining).toBe(0)
  })
})
