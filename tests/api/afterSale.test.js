/**
 * 售后闭环 + 订单删除权限（6 用例）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

const models = () => TestDatabase.getSequelize().models

async function makeUser (overrides = {}) {
  const { User } = models()
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
}

async function adminToken (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return TestHelpers.generateAdminToken(admin)
}

async function createOrderFor (user, product) {
  const token = TestHelpers.generateToken(user)
  const res = await request(app).post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      items: [{ product_id: product.id, quantity: 2 }],
      contact_name: 'X',
      contact_phone: '13800000001',
      delivery_address: 'A',
      payment_method: 'cod'
    })
  expect(res.status).toBe(201)
  return { token, order: res.body.data.order }
}

describe('AfterSale', () => {
  it('AS-1 仅退款：申请 → Admin 同意 → 订单取消 + 库存回补 + 申请状态 approved', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser()
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, category_id: cat.id }))
    const { token, order } = await createOrderFor(user, product)
    const admin = await adminToken()

    const apply = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '不想要了' })
    expect(apply.status).toBe(201)

    const duplicate = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '重复申请' })
    expect(duplicate.status).toBe(400)

    const review = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved', admin_note: '同意退款' })
    expect(review.status).toBe(200)

    const { Order } = models()
    expect((await Order.findByPk(order.id)).status).toBe('cancelled')
    expect((await Product.findByPk(product.id)).stock).toBe(10)
  })

  it('AS-2 退货退款：approved 不回补，received 才回补', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser()
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, category_id: cat.id }))
    const { token, order } = await createOrderFor(user, product)
    const admin = await adminToken()

    const apply = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'return', reason: '商品质量问题' })
    expect(apply.status).toBe(201)

    const approved = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
    expect(approved.status).toBe(200)
    expect((await Product.findByPk(product.id)).stock).toBe(8)

    const received = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'received' })
    expect(received.status).toBe(200)
    expect((await Product.findByPk(product.id)).stock).toBe(10)
  })

  it('AS-3 审核拒绝不回补库存', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser()
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, category_id: cat.id }))
    const { token, order } = await createOrderFor(user, product)
    const admin = await adminToken()

    const apply = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '想退货' })
    const reject = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'rejected' })
    expect(reject.status).toBe(200)
    expect((await Product.findByPk(product.id)).stock).toBe(8)
  })

  it('AS-4 其他用户不能申请他人订单售后', async () => {
    await seedSystemConfigBaseline()
    const owner = await makeUser()
    const other = await makeUser()
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, category_id: cat.id }))
    const { order } = await createOrderFor(owner, product)
    const otherToken = TestHelpers.generateToken(other)

    const res = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ type: 'refund', reason: '冒用' })
    expect(res.status).toBe(404)
  })

  it('AS-5 用户可查询自己的售后列表', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser()
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, category_id: cat.id }))
    const { token, order } = await createOrderFor(user, product)
    await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '测试列表' })

    const list = await request(app).get('/api/orders/after-sales/mine')
      .set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    expect(list.body.data.length).toBe(1)
    expect(list.body.data[0].order.order_no).toBe(order.order_no)
  })

  it('AS-6 普通 operator 不能硬删订单，super_admin 可以', async () => {
    await seedSystemConfigBaseline()
    const user = await makeUser()
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 100, category_id: cat.id }))
    const { order } = await createOrderFor(user, product)
    const operator = await adminToken('operator')
    const superAdmin = await adminToken('super_admin')

    const denied = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${operator}`)
    expect(denied.status).toBe(403)

    const allowed = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${superAdmin}`)
    expect(allowed.status).toBe(200)
  })
})
