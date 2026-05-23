/**
 * P3 Admin — 商品分类（6 用例）
 *   AC-1 GET /api/admin/product-categories 列表 happy → 200
 *   AC-2 POST 创建分类 happy → 201
 *   AC-3 POST 空名 → 400
 *   AC-4 PUT 更新 → 200
 *   AC-5 DELETE 空分类 → 200
 *   AC-6 DELETE 非空分类（含商品） → 400 拒绝
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
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

describe('P3.admin.category', () => {
  it('AC-1 GET 列表 happy', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    await ProductCategory.create(TestDataFactory.createProductCategory({ name: 'C1' }))
    await ProductCategory.create(TestDataFactory.createProductCategory({ name: 'C2' }))
    const res = await request(app).get('/api/admin/product-categories')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBe(2)
  })

  it('AC-2 POST 创建 happy → 201', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/admin/product-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Beverages', sort_order: 5 })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Beverages')
  })

  it('AC-3 POST 空名 → 400', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/admin/product-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('AC-4 PUT 更新 → 200', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const c = await ProductCategory.create(TestDataFactory.createProductCategory({ name: 'Old' }))
    const res = await request(app).put(`/api/admin/product-categories/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', sort_order: 9 })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('New')
  })

  it('AC-5 DELETE 空分类 → 200', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const c = await ProductCategory.create(TestDataFactory.createProductCategory({ name: 'Empty' }))
    const res = await request(app).delete(`/api/admin/product-categories/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('AC-6 DELETE 非空分类 → 400 拒绝', async () => {
    const { token } = await adminCtx()
    const { category } = await TestHelpers.createCategoryWithProducts({ count: 2 })
    const res = await request(app).delete(`/api/admin/product-categories/${category.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/无法删除/)
  })
})
