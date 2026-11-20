/**
 * 售后链的三端闭环（第 45 轮）
 * ============================
 *
 * ## 原来是什么样
 *
 * 后端的售后接口**一直都在**（申请 / 我的售后 / 管理端列表 / 审核），
 * 但**三端都没有任何界面调用它们**：
 *
 *   - 客户端：不能发起售后，也看不到自己提交的售后被处理成什么状态
 *   - 管理端：看不到任何售后单，更谈不上审核
 *
 * 结果是：用户提交的售后单在系统里 **pending 悬空** —— 谁也看不到、谁也处理不了。
 * 这是"功能不完整"里最严重的一条：**后端能力全部闲置**。
 *
 * ## 现在
 *
 * 客户端（申请 + 我的售后）与管理端（列表 + 审核）都接上了，本测试走**完整一圈**：
 *
 *   用户申请 → 管理端列表能看到 → 管理员审核通过 → 订单被取消/回补 →
 *   用户在「我的售后」里看到处理结果
 *
 * 另外做一道**静态护栏**：断言这三个接口**有前端调用方** ——
 * "接口存在但前端没入口"是这一轮的核心教训，不能再退化。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const models = () => TestDatabase.getSequelize().models

let user
let token
let adminToken
let order
let product

beforeEach(async () => {
  await TestDatabase.clearAllData()
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900006666'
  }))
  token = TestHelpers.generateToken(user)
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)

  product = await models().Product.create(TestDataFactory.createProduct({
    name: '售后测试商品', price: 100, stock: 50, status: 'active'
  }))
  order = await models().Order.create({
    order_no: `AS${Date.now()}`,
    user_id: user.id,
    total_amount: 200,
    total_amount_thb: 200,
    currency_code: 'THB',
    payment_method: 'cod',
    status: 'shipping',
    contact_name: '售后测试',
    contact_phone: '13800138000',
    delivery_address: '某路 9 号',
    exchange_rate: 1
  })
  await models().OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 2,
    price: 100,
    original_price: 100,
    product_name_zh: '售后测试商品'
  })
})

describe('售后闭环 · 行为', () => {
  it('AS-1 用户申请售后 → 管理端能看到 → 审核通过 → 用户看到结果（完整一圈）', async () => {
    // 1) 用户申请
    const apply = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '商品与描述不符' })
    expect(apply.status, `申请售后应当成功：${JSON.stringify(apply.body)}`).toBe(201)
    expect(apply.body.data.status).toBe('pending')

    // 2) 用户自己能看到（我的售后）
    const mine = await request(app).get('/api/orders/after-sales/mine')
      .set('Authorization', `Bearer ${token}`)
    expect(mine.status).toBe(200)
    expect(mine.body.data.length).toBe(1)
    expect(mine.body.data[0].status).toBe('pending')
    expect(mine.body.data[0].order?.order_no).toBe(order.order_no)

    // 3) 管理端能看到（之前管理端压根没有入口）
    const adminList = await request(app).get('/api/admin/after-sales')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminList.status).toBe(200)
    expect(adminList.body.data.length).toBe(1)
    expect(adminList.body.data[0].id).toBe(apply.body.data.id)

    // 4) 管理端审核通过（仅退款 → 不回补库存，订单置 cancelled）
    const review = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', admin_note: '已退款' })
    expect(review.status, `审核应当成功：${JSON.stringify(review.body)}`).toBe(200)
    expect(review.body.data.status).toBe('approved')

    // 5) 用户能看到处理结果
    const mine2 = await request(app).get('/api/orders/after-sales/mine')
      .set('Authorization', `Bearer ${token}`)
    const row = mine2.body.data.find(r => r.id === apply.body.data.id)
    expect(row.status).toBe('approved')
    expect(row.admin_note).toBe('已退款')

    // 6) 订单状态随之变化（闭环的"业务侧"也动了）
    const fresh = await models().Order.findByPk(order.id, { raw: true })
    expect(fresh.status, '审核通过后订单应被取消').toBe('cancelled')
  })

  it('AS-2 重复申请被拒（同一订单不能有两张进行中的售后单）', async () => {
    const first = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '第一次申请' })
    expect(first.status).toBe(201)

    const second = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '第二次申请' })
    expect(second.status).toBe(400)
    expect(second.body.message).toMatch(/已有进行中/)
  })

  it('AS-3 不能申请别人订单', async () => {
    const other = await models().User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13900007777'
    }))
    const otherToken = TestHelpers.generateToken(other)
    const res = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ type: 'refund', reason: '越权申请' })
    expect(res.status).toBe(404)
  })

  it('AS-4 退货退款：确认收货后回补库存（库存闭环）', async () => {
    const apply = await request(app).post(`/api/orders/${order.id}/after-sales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'return', reason: '商品要退回' })
    expect(apply.status).toBe(201)

    const before = (await models().Product.findByPk(product.id, { raw: true })).stock

    // 审核通过（return 类型：此时还没收到货，不回补库存）
    const approved = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })
    expect(approved.status).toBe(200)
    const afterApproved = (await models().Product.findByPk(product.id, { raw: true })).stock
    expect(afterApproved, '仅"确认收货"才回补库存').toBe(before)

    // 确认收货 → 回补库存
    const received = await request(app).put(`/api/admin/after-sales/${apply.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'received' })
    expect(received.status).toBe(200)
    const afterReceived = (await models().Product.findByPk(product.id, { raw: true })).stock
    expect(afterReceived, '确认收货后库存应回补').toBe(before + 2)
  })
})

describe('售后闭环 · 前端入口（静态护栏）', () => {
  /**
   * "接口存在但前端没入口"是这一轮最贵的教训：
   * 售后能力后端全有、前端全无，整条业务悬空了大半个项目周期。
   * 这条护栏保证：**这三个接口各自都有前端调用方**。
   */
  it('AS-5 售后接口都有前端调用方（不允许再变成"只有后端"）', () => {
    const portalApi = fs.readFileSync(path.join(ROOT, 'src/portal/api/orders.js'), 'utf8')
    const portalProfile = fs.readFileSync(path.join(ROOT, 'src/portal/views/Profile.vue'), 'utf8')
    const portalDetail = fs.readFileSync(path.join(ROOT, 'src/portal/views/order/OrderDetail.vue'), 'utf8')
    const adminApi = fs.readFileSync(path.join(ROOT, 'src/admin/api/afterSales.js'), 'utf8')
    const adminView = fs.readFileSync(path.join(ROOT, 'src/admin/views/AfterSales.vue'), 'utf8')

    expect(portalApi, '客户端要有「申请售后」与「我的售后」的接口封装')
      .toContain('/orders/${orderId}/after-sales')
    expect(portalApi, '客户端要有「我的售后」的接口封装')
      .toContain('/orders/after-sales/mine')
    expect(portalDetail, '订单详情页要有「申请售后」入口')
      .toContain('createAfterSale')
    expect(portalProfile, '个人中心要有「我的售后」列表')
      .toContain('loadMyAfterSales')
    expect(adminApi, '管理端要有售后列表与审核的接口封装')
      .toContain('/admin/after-sales')
    expect(adminView, '管理端要有售后页面（列表 + 审核）')
      .toContain('afterSaleAPI')
  })

  it('AS-6 售后页面与路由都已接上（不是只写了文件）', () => {
    const router = fs.readFileSync(path.join(ROOT, 'src/admin/router/index.js'), 'utf8')
    const layout = fs.readFileSync(path.join(ROOT, 'src/admin/components/Layout.vue'), 'utf8')
    expect(router, '管理端路由要有售后页').toContain("path: '/after-sales'")
    expect(layout, '管理端菜单要有售后入口').toContain('menu.afterSales')
  })
})
