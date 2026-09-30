/**
 * P3 Admin — 订单（8 用例）
 *   AO-1 GET /api/admin/orders 列表 happy → 200 + 分页
 *   AO-2 GET /api/admin/orders/:id 详情 happy（admin 可任意查）
 *   AO-3 PUT /api/admin/orders/:id/status 合法跳转 shipping → shipped → 200
 *   AO-4 PUT /api/admin/orders/:id/status 不存在订单 → 404
 *   AO-5 DELETE /api/admin/orders/:id 删除订单 + 子项 → 200
 *   AO-6 GET /api/admin/orders/export 导出（JSON 数组）→ 200 + 数据
 *   AO-7 GET /api/export/orders 导出 xlsx → 200 + Content-Disposition
 *   AO-8 operator 角色 → 200（具有 orders 权限）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

async function orderWithItems () {
  const sequelize = TestDatabase.getSequelize()
  const { User, Product, Order, OrderItem } = sequelize.models
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  const p = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 50 }))
  const o = await Order.create({
    order_no: `OA${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: u.id,
    total_amount: 100, total_amount_thb: 100, currency_code: 'THB',
    payment_method: 'cod', status: 'shipping',
    contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: o.id, product_id: p.id, quantity: 2, price: 50,
    original_price: 50, product_name_zh: p.name
  })
  return { user: u, product: p, order: o }
}

describe('P3.admin.order', () => {
  it('AO-1 GET 列表 happy', async () => {
    const { token } = await adminCtx()
    await orderWithItems()
    await orderWithItems()
    const res = await request(app).get('/api/admin/orders?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.orders.length).toBe(2)
  })

  it('AO-2 GET 详情 happy', async () => {
    const { token } = await adminCtx()
    const { order } = await orderWithItems()
    const res = await request(app).get(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(order.id)
  })

  it('AO-3 PUT /:id/status 合法跳转 shipping → shipped → 200', async () => {
    const { token } = await adminCtx()
    const { order } = await orderWithItems()
    const res = await request(app).put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('shipped')
  })

  it('AO-4 PUT /:id/status 不存在订单 → 404', async () => {
    const { token } = await adminCtx()
    const res = await request(app).put('/api/admin/orders/999999/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed' })
    expect(res.status).toBe(404)
  })

  it('AO-5 DELETE /:id 删除订单 + items → 200', async () => {
    const { token } = await adminCtx()
    const { order } = await orderWithItems()
    const res = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Order, OrderItem } = sequelize.models
    expect(await Order.findByPk(order.id)).toBeNull()
    expect(await OrderItem.count({ where: { order_id: order.id } })).toBe(0)
  })

  it('AO-6 GET /api/admin/orders/export → 200 数组', async () => {
    const { token } = await adminCtx()
    await orderWithItems()
    const res = await request(app).get('/api/admin/orders/export')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBe(1)
  })

  it('AO-7 GET /api/export/orders → 200 xlsx', async () => {
    const { token } = await adminCtx()
    await orderWithItems()
    const res = await request(app).get('/api/admin/export/orders')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
  })

  it('AO-8 operator 也能列表（具备 orders 权限）', async () => {
    const { token } = await adminCtx('operator')
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})
