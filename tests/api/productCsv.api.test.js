/**
 * 商品 CSV 导入 / 导出 接口测试
 *
 * 服务层的逻辑在 productCsv.test.js 里测了；这里测**HTTP 这一层**：
 * 鉴权、文件类型、multipart 解析、响应格式。
 *
 *   PA-1 未登录不能导入
 *   PA-2 未登录不能导出
 *   PA-3 没传文件 → 400
 *   PA-4 非 CSV 文件 → 400
 *   PA-5 默认是预览（不落库）
 *   PA-6 dry_run=false → 真的落库
 *   PA-7 有问题的行 → 400 且不落库
 *   PA-8 导出返回 CSV（带 Content-Disposition）
 *   PA-9 导出内容能被原样导回（往返）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let token
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator, ProductCategory } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `csv_admin_${Date.now()}`,
    password: 'CsvPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
  category = await ProductCategory.create({ name: 'CSV分类' })
})

/** 造一个 CSV 上传 */
function attachCsv (content, filename = 'products.csv', mime = 'text/csv') {
  return request(app)
    .post('/api/products/import')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from('﻿' + content, 'utf8'), { filename, contentType: mime })
}

describe('商品 CSV 导入 / 导出 接口', () => {
  it('PA-1 未登录不能导入', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .attach('file', Buffer.from('name,price\nA,1', 'utf8'), { filename: 'a.csv', contentType: 'text/csv' })
    expect([401, 403]).toContain(res.status)
  })

  it('PA-2 未登录不能导出', async () => {
    const res = await request(app).get('/api/products/export.csv')
    expect([401, 403]).toContain(res.status)
  })

  it('PA-3 没传文件 → 400', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('PA-4 非 CSV 文件 → 400', async () => {
    const res = await attachCsv('name,price\nA,1', 'products.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.status).toBe(400)
  })

  it('PA-5 默认是预览（不落库）', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const before = await Product.count()
    const res = await attachCsv('name,price,category\n预览商品,10,CSV分类')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.validCount).toBe(1)
    expect(res.body.data.createCount).toBe(1)
    // 关键：预览**不能**写库
    expect(await Product.count()).toBe(before)
  })

  it('PA-6 dry_run=false → 真的落库', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${token}`)
      .field('dry_run', 'false')
      .attach('file', Buffer.from('﻿name,price,stock,category\n真导入商品,25,7,CSV分类', 'utf8'), {
        filename: 'products.csv',
        contentType: 'text/csv'
      })
    expect(res.status).toBe(200)
    expect(res.body.data.createdCount).toBe(1)

    const created = await Product.findOne({ where: { name: '真导入商品' } })
    expect(created).toBeTruthy()
    expect(Number(created.price)).toBe(25)
    expect(created.stock).toBe(7)
    expect(created.category_id).toBe(category.id)
  })

  it('PA-7 有问题的行 → 400 且不落库', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const before = await Product.count()
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${token}`)
      .field('dry_run', 'false')
      .attach('file', Buffer.from('﻿name,price,category\n好商品,10,CSV分类\n坏商品,abc,CSV分类', 'utf8'), {
        filename: 'products.csv',
        contentType: 'text/csv'
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/存在问题/)
    // 整批不落库（半截导入比不导入更糟）
    expect(await Product.count()).toBe(before)
  })

  it('PA-8 导出返回 CSV（带 Content-Disposition）', async () => {
    const { Product } = TestDatabase.getSequelize().models
    await Product.create(TestDataFactory.createProduct({
      name: '导出商品', price: 12, category_id: category.id, stock: 3
    }))

    const res = await request(app)
      .get('/api/products/export.csv')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    expect(res.text).toContain('导出商品')
    expect(res.text).toContain('id,name,name_th,category,price,stock,points,description,image')
  })

  it('PA-9 导出内容能被原样导回（往返）', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const p = await Product.create(TestDataFactory.createProduct({
      name: '往返商品', price: 33.5, stock: 4, category_id: category.id
    }))

    const exported = await request(app)
      .get('/api/products/export.csv')
      .set('Authorization', `Bearer ${token}`)

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${token}`)
      .field('dry_run', 'false')
      .attach('file', Buffer.from(exported.text, 'utf8'), {
        filename: 'products.csv',
        contentType: 'text/csv'
      })
    expect(res.status).toBe(200)
    expect(res.body.data.updatedCount).toBe(1)
    expect(res.body.data.createdCount).toBe(0)

    const fresh = await Product.findByPk(p.id)
    expect(Number(fresh.price)).toBe(33.5)
    expect(fresh.stock).toBe(4)
  })
})
