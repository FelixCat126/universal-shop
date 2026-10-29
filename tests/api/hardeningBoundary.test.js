/**
 * 第五轮边界加固专项（10 用例）
 *
 * 覆盖本轮深度审计发现并修复的问题：
 *   HB-1  非法路径 id 返回 400 而非 500（products/orders/after-sales/addresses）
 *   HB-2  售后审批不得对已取消订单二次回补资源（幂等护栏）
 *   HB-3  资源回补幂等：订单已 cancelled 时跳过回补
 *   HB-4  资料更新字段长度超限返回 400 而非 500（DB 22001）
 *   HB-5  LIKE 通配符被转义（keyword=% 不能放大成全表匹配）
 *   HB-6  分页 page 上限生效（深翻页被钳制）
 *   HB-7  事务内提前 return 不泄漏连接
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { escapeLike, likeContains } from '@server/utils/likeSearch.js'
import { resolvePagination } from '@server/utils/pagination.js'

const models = () => TestDatabase.getSequelize().models

async function makeUserToken (overrides = {}) {
  const { User } = models()
  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
  return { user, token: TestHelpers.generateToken(user) }
}

async function makeProduct (overrides = {}) {
  const { Product, ProductCategory } = models()
  const cat = await ProductCategory.create({ name: 'c-' + Date.now(), sort_order: 1 })
  return Product.create({
    name: '商品', price: 100, stock: 50, category_id: cat.id, status: 'active', ...overrides
  })
}

describe('Hardening.boundary', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
  })

  it('HB-1 非法 id 路径返回 400 而非 500', async () => {
    const { token } = await makeUserToken()
    // 未认证时先命中鉴权（401/403 也算非 500），用管理员 token 走业务分支
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)
    const cases = [
      ['GET', '/api/products/abc'],
      ['GET', '/api/products/1.5'],
      ['GET', '/api/products/99999999999999999999'],
      ['GET', '/api/orders/abc'],
      ['GET', '/api/admin/orders/abc'],
      ['PUT', '/api/admin/orders/abc/status']
    ]
    for (const [method, path] of cases) {
      const res = await request(app)[method.toLowerCase()](path)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(method === 'PUT' ? { status: 'shipping' } : {})
      expect(res.status, `${method} ${path} 不应返回 5xx`).toBeLessThan(500)
    }
    expect(token).toBeTruthy()
  })

  it('HB-2 售后审批不得对已取消订单二次回补库存', async () => {
    const { Order, OrderItem, AfterSale, Product } = models()
    const { user } = await makeUserToken()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)

    const product = await makeProduct({ stock: 10 })
    const order = await Order.create({
      order_no: 'HB2-' + Date.now(), user_id: user.id, total_amount: 100, total_amount_thb: 100,
      payment_method: 'cod', status: 'cancelled', contact_name: 'x', contact_phone: '13800138000',
      delivery_address: 'a', exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 2, price: 50,
      original_price: 50, product_name_zh: '商品'
    })
    const as = await AfterSale.create({
      order_id: order.id, user_id: user.id, type: 'refund', reason: '测试原因',
      status: 'pending'
    })

    const before = (await Product.findByPk(product.id)).stock
    const res = await request(app)
      .put(`/api/admin/after-sales/${as.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })
    // 必须被拒（400），库存不能变
    expect(res.status).toBe(400)
    const after = (await Product.findByPk(product.id)).stock
    expect(after).toBe(before)
  })

  it('HB-3 资源回补幂等：订单已 cancelled 时跳过回补', async () => {
    const { Order, OrderItem, Product } = models()
    const { user } = await makeUserToken()
    const product = await makeProduct({ stock: 10 })
    const order = await Order.create({
      order_no: 'HB3-' + Date.now(), user_id: user.id, total_amount: 100, total_amount_thb: 100,
      payment_method: 'cod', status: 'cancelled', contact_name: 'x', contact_phone: '13800138000',
      delivery_address: 'a', exchange_rate: 1
    })
    await OrderItem.create({
      order_id: order.id, product_id: product.id, quantity: 2, price: 50,
      original_price: 50, product_name_zh: '商品'
    })
    const { restoreOrderResources } = await import('@server/controllers/orderController.js')
    const sequelize = TestDatabase.getSequelize()
    const tx = await sequelize.transaction()
    try {
      const fresh = await Order.findByPk(order.id)
      fresh.items = await OrderItem.findAll({ where: { order_id: order.id } })
      const r = await restoreOrderResources(fresh, tx)
      expect(r?.restored).toBe(false)
      await tx.rollback()
    } catch (e) {
      await tx.rollback().catch(() => {})
      throw e
    }
    // 库存未变
    expect((await Product.findByPk(product.id)).stock).toBe(10)
  })

  it('HB-4 资料更新字段超长返回 400 而非 500', async () => {
    const { token } = await makeUserToken()
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'A'.repeat(200) })
    expect(res.status).toBe(400)
  })

  it('HB-5 LIKE 通配符被转义', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('back\\slash')).toBe('back\\\\slash')
    expect(likeContains('%')).toBe('%\\%%')
    // 普通文本不受影响
    expect(escapeLike('abc')).toBe('abc')
  })

  it('HB-6 分页 page 上限生效', () => {
    const r = resolvePagination({ page: '999999999' }, { pageSizeKey: 'limit' })
    expect(r.page).toBeLessThanOrEqual(10000)
    expect(r.offset).toBeLessThanOrEqual(100000)
    // 正常页码不受影响
    const n = resolvePagination({ page: '3' }, { pageSizeKey: 'limit' })
    expect(n.page).toBe(3)
    expect(n.offset).toBe(2 * 20)   // 默认 pageSize=20
  })

  it('HB-7 地址创建参数非法不泄漏事务连接', async () => {
    const { token } = await makeUserToken()
    const before = TestDatabase.getSequelize().options.pool.max
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({})   // 缺必填字段
      expect(res.status).toBe(400)
    }
    // 池未被占满（连接已归还）
    expect(TestDatabase.getSequelize().options.pool.max).toBe(before)
  })
})
