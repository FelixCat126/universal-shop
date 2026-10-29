/**
 * 越权（IDOR / 垂直越权）黑盒探测
 *
 * 方法：造两个真实用户 A/B 与一个管理员/合作方，交叉尝试访问对方资源。
 * 只看 HTTP 状态码与响应体，不依赖中间件内部逻辑 ——
 * 路由挂载顺序、中间件组合、控制器二次校验都可能让「中间件看起来对、实际放行」。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let userA, userB, tokenA, tokenB, adminToken, partnerToken
let orderA, addressA, product

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { User, Order, OrderItem, Address, Product, ProductCategory, Partner, Administrator } = models()

  userA = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
  }))
  userB = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
  }))
  tokenA = TestHelpers.generateToken(userA)
  tokenB = TestHelpers.generateToken(userB)

  const cat = await ProductCategory.create({ name: 'cat-' + Date.now(), sort_order: 1 })
  product = await Product.create({
    name: '商品', price: 100, stock: 50, category_id: cat.id, status: 'active'
  })

  orderA = await Order.create({
    order_no: 'IDOR-' + Date.now(), user_id: userA.id, total_amount: 100, total_amount_thb: 100,
    payment_method: 'cod', status: 'shipping', contact_name: 'A', contact_phone: '13800138000',
    delivery_address: '地址A', exchange_rate: 1
  })
  await OrderItem.create({
    order_id: orderA.id, product_id: product.id, quantity: 1, price: 100,
    original_price: 100, product_name_zh: '商品'
  })

  addressA = await Address.create({
    user_id: userA.id, contact_name: 'A', contact_phone: '13800138000',
    country_code: '+86', province: '省', city: '市', district: '区',
    detail_address: '详细地址A', full_address: '省市区详细地址A', is_default: true
  })

  const admin = await Administrator.create(await TestDataFactory.createAdmin({ role: 'super_admin' }))
  adminToken = TestHelpers.generateAdminToken(admin)

  const partner = await Partner.create({
    login: 'idor-partner', password: 'x', display_name: 'IDOR合作方',
    account_kind: 'dealer', discount_percent: 0, is_active: true
  })
  partnerToken = TestHelpers.generatePartnerToken(partner)
})

describe('IDOR.horizontal', () => {
  it('IDOR-1 用户 B 不能读取用户 A 的订单详情', async () => {
    const res = await request(app).get(`/api/orders/${orderA.id}`).set('Authorization', `Bearer ${tokenB}`)
    expect([403, 404]).toContain(res.status)
  })

  it('IDOR-2 用户 B 不能对用户 A 的订单发起售后', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderA.id}/after-sales`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ type: 'refund', reason: '恶意申请' })
    expect([403, 404]).toContain(res.status)
  })

  it('IDOR-3 用户 B 不能对用户 A 的订单确认在线支付', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderA.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
    expect([403, 404]).toContain(res.status)
  })

  it('IDOR-4 用户 B 不能修改/删除用户 A 的地址', async () => {
    const put = await request(app)
      .put(`/api/addresses/${addressA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ contact_name: '恶意修改', contact_phone: '13800138000', detail_address: 'x' })
    expect([403, 404]).toContain(put.status)

    const del = await request(app)
      .delete(`/api/addresses/${addressA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
    expect([403, 404]).toContain(del.status)
  })

  it('IDOR-5 用户 B 不能把用户 A 的地址设为默认', async () => {
    const res = await request(app)
      .put(`/api/addresses/${addressA.id}/default`)
      .set('Authorization', `Bearer ${tokenB}`)
    expect([403, 404]).toContain(res.status)
  })

  it('IDOR-6 用户 B 不能领取/使用用户 A 的券', async () => {
    const { CouponTemplate, UserCoupon } = models()
    const tpl = await CouponTemplate.create({
      name: '越权测试券', amount: 50, min_spend: 0, total: 10, per_user: 1,
      status: 'active', scope: { type: 'all' }, register_gift: false,
      valid_from: new Date(Date.now() - 3600_000), valid_to: new Date(Date.now() + 86400_000)
    })
    const ucA = await UserCoupon.create({
      template_id: tpl.id, user_id: userA.id, code: 'IA' + Date.now(), status: 'unused', expire_at: null
    })
    // B 试图在订单里使用 A 的券
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        contact_name: 'B', contact_phone: '13800138001', delivery_address: 'B地址',
        items: [{ product_id: product.id, quantity: 1 }],
        payment_method: 'cod',
        user_coupon_id: ucA.id
      })
    // 不应创建出使用了他人的券的订单
    expect(res.status).toBe(400)
  })
})

describe('IDOR.vertical', () => {
  it('IDOR-7 用户 token 不能访问管理端任何接口', async () => {
    for (const path of ['/api/admin/users', '/api/admin/orders', '/api/admin/partners', '/api/admin/metrics']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${tokenA}`)
      expect([401, 403], `用户访问 ${path}`).toContain(res.status)
    }
  })

  it('IDOR-8 合作方 token 不能访问管理端与用户端接口', async () => {
    for (const path of ['/api/admin/users', '/api/admin/partners', '/api/users/profile', '/api/orders']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${partnerToken}`)
      expect([401, 403], `合作方访问 ${path}`).toContain(res.status)
    }
  })

  it('IDOR-9 管理员 token 不能操作用户数据（无该路由即 404/405）', async () => {
    const res = await request(app)
      .put(`/api/users/profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nickname: '管理员改名' })
    expect([400, 401, 403, 404, 405]).toContain(res.status)
  })

  it('IDOR-10 无 token 不能访问任何受保护接口', async () => {
    for (const path of ['/api/users/profile', '/api/orders', '/api/addresses', '/api/coupons/mine']) {
      const res = await request(app).get(path)
      expect([401, 403], `无 token 访问 ${path}`).toContain(res.status)
    }
  })

  it('IDOR-11 用户 B 不能用 A 的 user_coupon_id 抵扣自己的订单', async () => {
    const { CouponTemplate, UserCoupon } = models()
    const tpl = await CouponTemplate.create({
      name: 'IDOR券2', amount: 50, min_spend: 0, total: 10, per_user: 1,
      status: 'active', scope: { type: 'all' }, register_gift: false,
      valid_from: new Date(Date.now() - 3600_000), valid_to: new Date(Date.now() + 86400_000)
    })
    const ucA = await UserCoupon.create({
      template_id: tpl.id, user_id: userA.id, code: 'IB' + Date.now(), status: 'unused', expire_at: null
    })
    const before = (await UserCoupon.findByPk(ucA.id)).status
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        contact_name: 'B', contact_phone: '13800138002', delivery_address: 'B地址',
        items: [{ product_id: product.id, quantity: 1 }],
        payment_method: 'cod',
        user_coupon_id: ucA.id
      })
    if (res.status === 201) {
      // 若创建成功，券也不应被核销为「已使用」（核销必须验归属）
      expect((await UserCoupon.findByPk(ucA.id)).status).toBe(before)
    } else {
      expect(res.status).toBe(400)
    }
  })
})
