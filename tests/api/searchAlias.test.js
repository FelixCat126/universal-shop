/**
 * 商品别名搜索 + 统计短缓存 测试
 *
 *   SA-1 按中文名搜得到
 *   SA-2 按泰文名搜得到
 *   SA-3 **按别名搜得到**（之前搜不到 —— 运营填了别名客户却搜不着）
 *   SA-4 别名里的特殊字符（% / _）按字面量处理，不会放大成全表匹配
 *   SA-5 订单列表统计：按状态筛选时统计跟着变（缓存键必须含筛选条件）
 *   SA-6 总览统计数字正确
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
    username: `sa_admin_${Date.now()}`,
    password: 'SaPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
  category = await ProductCategory.create({ name: '搜索分类' })
})

describe('商品别名搜索', () => {
  it('SA-1 按中文名搜得到', async () => {
    await Product_create({ name: '柠檬茶', alias: '柠檬的茶' })
    const res = await request(app).get('/api/products').query({ name: '柠檬茶' })
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(1)
  })

  it('SA-2 按泰文名搜得到', async () => {
    await Product_create({ name: '泰式奶茶', name_th: 'ชานมไทย' })
    const res = await request(app).get('/api/products').query({ name: 'ชานม' })
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(1)
  })

  it('SA-3 按别名搜得到（之前搜不到）', async () => {
    await Product_create({ name: '商品正名', alias: '客户口头叫法' })
    const res = await request(app).get('/api/products').query({ name: '口头叫法' })
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(1)
    expect(res.body.data.products[0].name).toBe('商品正名')
  })

  it('SA-4 别名里的 % / _ 按字面量处理', async () => {
    await Product_create({ name: '正常商品', alias: '100%纯' })
    await Product_create({ name: '另一个', alias: '普通' })
    // 搜 "100%" 应只命中字面量含 "100%" 的那个，
    // 而不是把所有含 "100" 的都匹配上
    const res = await request(app).get('/api/products').query({ name: '100%' })
    expect(res.status).toBe(200)
    expect(res.body.data.products.length).toBe(1)
    expect(res.body.data.products[0].alias).toBe('100%纯')
  })
})

describe('统计短缓存', () => {
  it('SA-5 订单列表统计：按状态筛选时统计跟着变', async () => {
    const { Order, User } = TestDatabase.getSequelize().models
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    }))
    const mk = (status, amount) => Order.create({
      order_no: `SA${Date.now()}${Math.floor(Math.random() * 1000)}`,
      user_id: u.id, total_amount: amount, total_amount_thb: amount,
      currency_code: 'THB', payment_method: 'cod', status, exchange_rate: 1
    })
    await mk('completed', 100)
    await mk('completed', 200)
    await mk('cancelled', 400)

    const all = await request(app).get('/api/admin/orders')
      .set('Authorization', `Bearer ${token}`)
    expect(all.status).toBe(200)
    expect(all.body.data.stats.total).toBe(3)
    expect(all.body.data.stats.completed).toBe(2)
    expect(Number(all.body.data.stats.totalAmount)).toBe(700)

    // 换筛选条件 → 统计必须跟着变（缓存键要含筛选条件）
    const done = await request(app).get('/api/admin/orders?status=completed')
      .set('Authorization', `Bearer ${token}`)
    expect(done.status).toBe(200)
    expect(done.body.data.stats.completed).toBe(2)
    expect(Number(done.body.data.stats.totalAmount)).toBe(300)
  })

  it('SA-6 总览统计数字正确', async () => {
    const { Order, User } = TestDatabase.getSequelize().models
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: `138${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    }))
    await Order.create({
      order_no: `OV${Date.now()}`, user_id: u.id, total_amount: 50, total_amount_thb: 50,
      currency_code: 'THB', payment_method: 'cod', status: 'completed', exchange_rate: 1
    })

    const res = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.totalOrders).toBeGreaterThanOrEqual(1)
    expect(Number(res.body.data.totalAmount)).toBeGreaterThanOrEqual(50)
    expect(res.body.data.totalUsers).toBeGreaterThanOrEqual(1)
  })
})

/** 造一个商品 */
async function Product_create (overrides = {}) {
  const { Product } = TestDatabase.getSequelize().models
  return Product.create(TestDataFactory.createProduct({
    name: '测试商品',
    category_id: category.id,
    stock: 10,
    price: 50,
    ...overrides
  }))
}
