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

  it('AP-4b PUT /:id 改上架状态 → 200（管理端以前没有地方能上下架）', async () => {
    const { token } = await adminCtx()
    const category = await makeCategory()
    const { Product } = TestDatabase.getSequelize().models
    const p = await Product.create(TestDataFactory.createProduct({
      name: '上下架测试', category_id: category.id, price: 100, status: 'active'
    }))

    // 下架
    const off = await request(app)
      .put(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inactive' })
    expect(off.status).toBe(200)
    await p.reload()
    expect(p.status).toBe('inactive')

    // 再上架
    const on = await request(app)
      .put(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
    expect(on.status).toBe(200)
    await p.reload()
    expect(p.status).toBe('active')

    // 非法状态 → 400（不能把脏值写进 ENUM 字段变成 500）
    const bad = await request(app)
      .put(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'deleted' })
    expect(bad.status).toBe(400)
    await p.reload()
    expect(p.status).toBe('active') // 非法值没有生效
  })

  it('AP-4c POST /bulk 批量上下架/删除', async () => {
    const { token } = await adminCtx()
    const category = await makeCategory()
    const { Product } = TestDatabase.getSequelize().models
    const ps = []
    for (let i = 0; i < 3; i++) {
      ps.push(await Product.create(TestDataFactory.createProduct({
        name: `批量${i}`, category_id: category.id, price: 100, status: 'active'
      })))
    }

    // 批量下架
    const off = await request(app)
      .post('/api/products/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ps.map(p => p.id), action: 'deactivate' })
    expect(off.status).toBe(200)
    expect(off.body.data.affected).toBe(3)
    for (const p of ps) {
      await p.reload()
      expect(p.status).toBe('inactive')
    }

    // 批量上架
    const on = await request(app)
      .post('/api/products/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ps.map(p => p.id), action: 'activate' })
    expect(on.status).toBe(200)
    for (const p of ps) {
      await p.reload()
      expect(p.status).toBe('active')
    }

    // 批量删除（软删）
    const del = await request(app)
      .post('/api/products/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ps.map(p => p.id), action: 'delete' })
    expect(del.status).toBe(200)
    expect(del.body.data.affected).toBe(3)
    // 软删：管理员仍能在列表里看到（可以恢复），但 deletedAt 已被标记
    for (const p of ps) {
      const fresh = await Product.findByPk(p.id, { paranoid: false })
      expect(fresh.deleted_at).toBeTruthy()
    }
    // 匿名（前台）列表查不到
    const pub = await request(app).get('/api/products')
    for (const p of ps) {
      expect(pub.body.data.products.find(x => x.id === p.id)).toBeUndefined()
    }
  })

  it('AP-4d POST /bulk 参数非法 → 400', async () => {
    const { token } = await adminCtx()
    const post = (body) => request(app)
      .post('/api/products/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send(body)

    expect((await post({ ids: [], action: 'activate' })).status).toBe(400)
    expect((await post({ ids: 'abc', action: 'activate' })).status).toBe(400)
    expect((await post({ ids: [1], action: 'unknown' })).status).toBe(400)
    // 超量
    expect((await post({ ids: Array.from({ length: 201 }, (_, i) => i + 1), action: 'activate' })).status).toBe(400)
    // 未登录
    const noAuth = await request(app).post('/api/products/bulk').send({ ids: [1], action: 'activate' })
    expect(noAuth.status).toBe(401)
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
