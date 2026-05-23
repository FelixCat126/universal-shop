/**
 * P1 用户面 — 商品/分类浏览（6 用例）
 *   C-1 GET /api/products 列表 happy → 200 分页结构
 *   C-2 GET /api/products?name=xxx 模糊搜索命中
 *   C-3 GET /api/products?category_id=N 精准筛选
 *   C-4 GET /api/products/:id happy → 200 详情
 *   C-5 GET /api/products/:id 不存在 → 404
 *   C-6 POST /api/products/check-stock 批量库存查 → 200
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

describe('P1.portal.catalog', () => {
  it('C-1 GET /api/products 列表 happy → 200 + 分页', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    for (let i = 0; i < 3; i++) {
      await Product.create(TestDataFactory.createProduct({ stock: 10, status: 'active' }))
    }
    const res = await request(app).get('/api/products?page=1&pageSize=20')
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(3)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.page).toBe(1)
  })

  it('C-2 GET /api/products?name=keyword 模糊搜索命中', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    await Product.create(TestDataFactory.createProduct({ name: 'apple-juice', stock: 5 }))
    await Product.create(TestDataFactory.createProduct({ name: 'orange-juice', stock: 5 }))
    await Product.create(TestDataFactory.createProduct({ name: 'water', stock: 5 }))

    const res = await request(app).get('/api/products?name=juice')
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(2)
  })

  it('C-3 GET /api/products?category_id=N 精准筛选', async () => {
    const { category, products } = await TestHelpers.createCategoryWithProducts({ count: 2 })
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    // 另一个分类的产品（无 category_id）
    await Product.create(TestDataFactory.createProduct({ name: 'standalone' }))

    const res = await request(app).get(`/api/products?category_id=${category.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(2)
    expect(res.body.data.products.map((p) => p.id).sort()).toEqual(
      products.map((p) => p.id).sort()
    )
  })

  it('C-4 GET /api/products/:id happy → 200 详情', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await Product.create(TestDataFactory.createProduct({ name: 'foo', stock: 3 }))
    const res = await request(app).get(`/api/products/${p.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(p.id)
    expect(res.body.data.name).toBe('foo')
  })

  it('C-5 GET /api/products/:id 不存在 → 404', async () => {
    const res = await request(app).get('/api/products/999999')
    expect(res.status).toBe(404)
  })

  it('C-6 POST /api/products/check-stock 批量库存查 → 200', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p1 = await Product.create(TestDataFactory.createProduct({ stock: 7 }))
    const p2 = await Product.create(TestDataFactory.createProduct({ stock: 0 }))

    const res = await request(app).post('/api/products/check-stock').send({
      productIds: [p1.id, p2.id]
    })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBe(2)
    const map = new Map(res.body.data.map((r) => [r.id, r.stock]))
    expect(map.get(p1.id)).toBe(7)
    expect(map.get(p2.id)).toBe(0)
  })
})
