/**
 * P3 Admin — 商品 CRUD + 库存 + 上下架（8 用例）
 *   AP-1 POST /api/products 创建商品 happy → 201
 *   AP-2 POST 缺必填 → 400
 *   AP-3 POST category_id 不存在 → 400
 *   AP-4 PUT /:id 更新名/价 → 200
 *   AP-5 POST /:id/stock add → 200，stock 增加
 *   AP-6 POST /:id/stock subtract 库存不足 → 400
 *   AP-7 DELETE 软删 → 200，再 GET (paranoid) 列表不可见
 *   AP-8 POST /:id/restore 恢复 → 200
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  const token = TestHelpers.generateAdminToken(admin)
  return { admin, token }
}

async function makeCategory () {
  const sequelize = TestDatabase.getSequelize()
  const { ProductCategory } = sequelize.models
  return ProductCategory.create(TestDataFactory.createProductCategory({ name: 'Foods' }))
}

describe('P3.admin.product', () => {
  it('AP-1 POST 创建商品 happy → 201', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()

    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'NewItem', category_id: cat.id, price: 99.5, stock: 20 })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('NewItem')
  })

  it('AP-2 POST 缺必填 → 400', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()
    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: cat.id, price: 1, stock: 1 })
    expect(res.status).toBe(400)
  })

  it('AP-3 POST category_id 不存在 → 400', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', category_id: 99999, price: 1, stock: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/分类/)
  })

  it('AP-4 PUT /:id 更新名/价 → 200', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ category_id: cat.id, price: 50, name: 'Old' }))
    const res = await request(app).put(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', price: 60 })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('New')
    expect(parseFloat(res.body.data.price)).toBe(60)
  })

  it('AP-5 POST /:id/stock add → 200，stock 增加', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ category_id: cat.id, stock: 10 }))
    const res = await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'add', quantity: 5 })
    expect(res.status).toBe(200)
    const fresh = await Product.findByPk(p.id)
    expect(fresh.stock).toBe(15)
  })

  it('AP-6 POST /:id/stock subtract 库存不足 → 400', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ category_id: cat.id, stock: 3 }))
    const res = await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'subtract', quantity: 5 })
    expect(res.status).toBe(400)
  })

  it('AP-7 DELETE 软删 → 200，paranoid 列表不可见', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ category_id: cat.id, stock: 1 }))
    const del = await request(app).delete(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const pub = await request(app).get('/api/products')
    expect(pub.body.data.products.find((x) => x.id === p.id)).toBeFalsy()
  })

  it('AP-8 POST /:id/restore 恢复 → 200', async () => {
    const { token } = await adminCtx()
    const cat = await makeCategory()
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ category_id: cat.id, stock: 1 }))
    await request(app).delete(`/api/products/${p.id}`).set('Authorization', `Bearer ${token}`)
    const res = await request(app).post(`/api/products/${p.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const fresh = await Product.findByPk(p.id, { paranoid: true })
    expect(fresh).toBeTruthy()
  })
})
