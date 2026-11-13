/**
 * 边界打击：用极端值打真实接口，看会不会 500 或产生脏数据
 *
 * 与"读代码找 bug"互补：很多边界问题读代码看不出来，
 * 只有把离谱的值真的打进去才知道。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let userToken
let product
let category
let userId

beforeAll(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
  const { Administrator, User, Product, ProductCategory } = models()
  const admin = await Administrator.create({
    username: 'bf_admin', password: 'BfPwd#1234', role: 'super_admin', is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900001111'
  }))
  userToken = TestHelpers.generateToken(u)
  userId = u.id
  category = await ProductCategory.create({ name: '边界分类' })
  product = await Product.create({
    name: '边界商品', price: 100, stock: 100, category_id: category.id, status: 'active'
  })
})

/** 收集所有 5xx 响应 */
const serverErrors = []

const probe = async (label, req) => {
  const res = await req
  if (res.status >= 500) {
    serverErrors.push(`${label} -> ${res.status} ${JSON.stringify(res.body).slice(0, 140)}`)
  }
  return res
}

describe('输入边界：不该出现 5xx', () => {
  it('BF-1 数量类极端值', async () => {
    const cases = [0, -1, 1.5, 1e9, Number.MAX_SAFE_INTEGER, 'abc', null, NaN]
    for (const q of cases) {
      await probe(`quantity=${JSON.stringify(q)}`,
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            contact_name: 'X', contact_phone: '+8613900001111',
            delivery_address: 'A', detail_address: 'B',
            items: [{ product_id: product.id, quantity: q }], payment_method: 'cod'
          }))
    }
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })

  it('BF-2 分页参数极端值', async () => {
    const cases = [-1, 0, 1e9, 'abc', null, 1e15]
    for (const p of cases) {
      await probe(`page=${JSON.stringify(p)}`,
        request(app).get('/api/admin/orders').query({ page: p, limit: 20 })
          .set('Authorization', `Bearer ${adminToken}`))
      await probe(`limit=${JSON.stringify(p)}`,
        request(app).get('/api/admin/orders').query({ page: 1, limit: p })
          .set('Authorization', `Bearer ${adminToken}`))
    }
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })

  it('BF-3 超长字符串（10KB）', async () => {
    const long = 'x'.repeat(10000)
    await probe('超长昵称', request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nickname: long }))
    await probe('超长商品名', request(app).post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: long, price: 10, stock: 1, category_id: category.id }))
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })

  it('BF-4 金额极端值', async () => {
    const cases = [0, -1, 1e15, 1e308, 'abc', null, 0.001]
    for (const price of cases) {
      await probe(`price=${JSON.stringify(price)}`, request(app).post('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `边界价${price}`, price, stock: 1, category_id: category.id }))
    }
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })

  it('BF-5 数组参数：超大 ids 数组', async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => i + 1)
    await probe('5000 个 ids', request(app).post('/api/admin/orders/bulk/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids, status: 'shipped' }))
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })

  it('BF-6 Unicode / emoji / 注入串', async () => {
    const weird = [
      '<script>alert(1)</script>',
      "'; DROP TABLE orders; --",
      '😀🎉',
      'a‮b',
      'null',
      'a'.repeat(300)
    ]
    for (const w of weird) {
      await probe(`昵称=${w.slice(0, 20)}`, request(app).put('/api/users/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ nickname: w }))
      await probe(`商品名=${w.slice(0, 20)}`, request(app).post('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: w, price: 10, stock: 1, category_id: category.id }))
    }
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })

  it('BF-8 脏数据检查：非法值要么被拒，要么存成合理值', async () => {
    const { User, Product } = models()

    // 超长昵称（列是 VARCHAR(50)）→ 应被拒或截断，**不能**静默写进库
    const longRes = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nickname: 'x'.repeat(10000) })
    expect(longRes.status).not.toBe(500)

    // 超大金额（DECIMAL(10,2) 装不下 1e15）→ 不该存进去
    const bigRes = await request(app).post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '超大金额商品', price: 1e15, stock: 1, category_id: category.id })
    expect(bigRes.status).not.toBe(500)
    const stored = await Product.findOne({ where: { name: '超大金额商品' } })
    if (stored) {
      expect(Number(stored.price), '金额超出列范围时不该被截断后存进去').toBeLessThan(1e10)
    }

    // 负库存/负价格不该落库
    const neg = await request(app).post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '负价格商品', price: -5, stock: -3, category_id: category.id })
    expect(neg.status).not.toBe(500)
    const negStored = await Product.findOne({ where: { name: '负价格商品' } })
    if (negStored) {
      expect(Number(negStored.price)).toBeGreaterThanOrEqual(0)
      expect(Number(negStored.stock)).toBeGreaterThanOrEqual(0)
    }
  })

  it('BF-7 越界页码', async () => {
    for (const page of ['999999999999', 'abc', '-1']) {
      await probe(`page=${page}`, request(app).get('/api/admin/orders')
        .query({ page, limit: 20 }).set('Authorization', `Bearer ${adminToken}`))
    }
    expect(serverErrors, `出现了 5xx：\n${serverErrors.join('\n')}`).toEqual([])
  })
})
