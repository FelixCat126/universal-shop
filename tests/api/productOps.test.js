/**
 * 商品运营路径的边界测试（上下架 / 改库存 / 查库存）
 *
 * 这些是运营每天在后台点的东西 —— 之前主路径有测，
 * 但**边界与失败分支**大面积没测（改库存类型写错、库存调成负数、
 * 查库存传非数组……）。
 *
 *   PO-1 改库存：type 非法 → 400
 *   PO-2 改库存：数量非法（负数/超大/非整数）→ 400
 *   PO-3 改库存：set / add / subtract 三种语义正确
 *   PO-4 改库存：subtract 超过现有库存 → 400，库存不变
 *   PO-5 改库存：商品不存在 → 404
 *   PO-6 改库存：无效 id → 400
 *   PO-7 查库存：productIds 非数组 → 400
 *   PO-8 查库存：正常 → 200 + 每项的 id/stock
 *   PO-9 下架：下架后公开列表里看不到，但软删数据还在
 *   PO-10 重新上架：把软删的商品恢复
 *   PO-11 重新上架：商品本来就没删 → 400
 *   PO-12 重新上架：商品不存在 → 404
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let token
let product
let ProductModel

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator, Product } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `po_admin_${Date.now()}`,
    password: 'PoPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
  product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 50 }))
  ProductModel = Product
})

const admin = (method, url) =>
  request(app)[method](url).set('Authorization', `Bearer ${token}`)

describe('商品运营边界', () => {
  it('PO-1 改库存：type 非法 → 400', async () => {
    for (const type of ['increment', '', 'SET', undefined]) {
      const res = await admin('post', `/api/products/${product.id}/stock`).send({ type, quantity: 1 })
      expect(res.status, `type=${type}`).toBe(400)
    }
  })

  it('PO-2 改库存：数量非法 → 400', async () => {
    for (const quantity of [-1, 1000001, 1.5, 'abc']) {
      const res = await admin('post', `/api/products/${product.id}/stock`).send({ type: 'add', quantity })
      expect(res.status, `quantity=${quantity}`).toBe(400)
    }
  })

  it('PO-3 改库存：set / add / subtract 三种语义正确', async () => {
    const set = await admin('post', `/api/products/${product.id}/stock`).send({ type: 'set', quantity: 50 })
    expect(set.status).toBe(200)
    expect((await ProductModel.findByPk(product.id)).stock).toBe(50)

    const add = await admin('post', `/api/products/${product.id}/stock`).send({ type: 'add', quantity: 5 })
    expect(add.status).toBe(200)
    expect((await ProductModel.findByPk(product.id)).stock).toBe(55)

    const sub = await admin('post', `/api/products/${product.id}/stock`).send({ type: 'subtract', quantity: 15 })
    expect(sub.status).toBe(200)
    expect((await ProductModel.findByPk(product.id)).stock).toBe(40)
  })

  it('PO-4 改库存：subtract 超过现有库存 → 400，库存不变', async () => {
    const res = await admin('post', `/api/products/${product.id}/stock`).send({ type: 'subtract', quantity: 999 })
    expect(res.status).toBe(400)
    expect((await ProductModel.findByPk(product.id)).stock).toBe(10)
  })

  it('PO-5 改库存：商品不存在 → 404', async () => {
    const res = await admin('post', '/api/products/999999/stock').send({ type: 'add', quantity: 1 })
    expect(res.status).toBe(404)
  })

  it('PO-6 改库存：无效 id → 400（不是 500）', async () => {
    const res = await admin('post', '/api/products/abc/stock').send({ type: 'add', quantity: 1 })
    expect(res.status).toBe(400)
  })

  it('PO-7 查库存：productIds 非数组 → 400', async () => {
    for (const body of [{}, { productIds: 'abc' }, { productIds: null }]) {
      const res = await request(app).post('/api/products/check-stock').send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('PO-8 查库存：正常 → 200 + 每项的 id/stock', async () => {
    const res = await request(app).post('/api/products/check-stock').send({ productIds: [product.id] })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data[0].id).toBe(product.id)
    expect(res.body.data[0].stock).toBe(10)
  })

  it('PO-9 下架：公开列表里看不到，软删数据还在', async () => {
    const del = await admin('delete', `/api/products/${product.id}`)
    expect(del.status).toBe(200)

    // 公开列表（默认过滤软删）
    const list = await request(app).get('/api/products')
    expect(list.status).toBe(200)
    const ids = (list.body.data?.products || []).map(p => p.id)
    expect(ids).not.toContain(product.id)

    // 数据还在（paranoid:false 能查到）
    const soft = await ProductModel.findByPk(product.id, { paranoid: false })
    expect(soft).toBeTruthy()
    expect(soft.deleted_at || soft.deletedAt).toBeTruthy()
  })

  it('PO-10 重新上架：把软删的商品恢复', async () => {
    await admin('delete', `/api/products/${product.id}`)
    const res = await admin('post', `/api/products/${product.id}/restore`)
    expect(res.status).toBe(200)

    const fresh = await ProductModel.findByPk(product.id)
    expect(fresh).toBeTruthy()
    expect(fresh.deleted_at).toBeNull()
  })

  it('PO-11 重新上架：商品本来就没删 → 400', async () => {
    const res = await admin('post', `/api/products/${product.id}/restore`)
    expect(res.status).toBe(400)
  })

  it('PO-12 重新上架：商品不存在 → 404', async () => {
    const res = await admin('post', '/api/products/999999/restore')
    expect(res.status).toBe(404)
  })
})
