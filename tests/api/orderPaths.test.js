/**
 * 订单控制器：未覆盖的业务路径补测
 *
 * 这些路径之前完全没测，而它们恰恰是**出错时代价最高**的：
 *   - 用已保存地址下单（地址归属校验 —— 能不能用别人的地址？）
 *   - 订单列表按关键词搜（用户昵称/手机号/用户名 → 单号/收货人/电话）
 *   - 订单详情的推荐人信息
 *   - 确认在线支付的竞态分支（affected=0 时重读订单甄别真实状态）
 *   - 改订单状态的非法输入（坏 id / 不合法流转）
 *
 *   OR-1 用自己的已保存地址下单 → 带上完整地址信息
 *   OR-2 用**别人**的地址下单 → 400（越权）
 *   OR-3 关键词搜索：命中单号/收货人/电话/用户昵称
 *   OR-4 关键词搜索：没有命中 → 空列表
 *   OR-5 订单详情带推荐人信息
 *   OR-6 订单详情：别人的订单 → 404
 *   OR-7 改状态：非法 id → 400
 *   OR-8 改状态：不合法的流转 → 400
 *   OR-9 改状态：订单不存在 → 404
 *   OR-10 取消订单 → 库存回补
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let token
let user
let product
let productModel
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `or_admin_${Date.now()}`,
    password: 'OrPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)

  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models
  productModel = ProductModel
  category = await ProductCategory.create({ name: '订单测试分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '订单测试商品', price: 50, stock: 100, category_id: category.id
  }))
  user = await User_create()
})

/** 造一个用户 */
async function User_create (overrides = {}) {
  const { User } = TestDatabase.getSequelize().models
  return User.create(await TestDataFactory.createUser({
    nickname: '订单测试用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    ...overrides
  }))
}

/** 建一张订单 */
async function makeOrder (overrides = {}) {
  const { Order, OrderItem } = TestDatabase.getSequelize().models
  const order = await Order.create({
    order_no: `OR${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    status: 'pending',
    contact_name: '收货人',
    contact_phone: '13800000000',
    delivery_address: '某地某路 1 号',
    ...overrides
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 2,
    price: 50,
    original_price: 50,
    product_name_zh: product.name
  })
  return order
}

describe('订单：已保存地址下单', () => {
  it('OR-1 用自己的已保存地址下单 → 带上完整地址信息', async () => {
    const { Address } = TestDatabase.getSequelize().models
    const address = await Address.create({
      user_id: user.id,
      contact_name: '地址联系人',
      contact_phone: '13811112222',
      province: '曼谷',
      city: '曼谷',
      district: '空堤',
      postal_code: '10400',
      detail_address: '测试路 9 号',
      full_address: '曼谷 曼谷 空堤 测试路 9 号 10400',
      is_default: true
    })

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${TestHelpers.generateToken(user)}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '表单联系人',
        contact_phone: '13800001111',
        delivery_address: '表单里的地址（会被已保存地址覆盖）',
        address_id: address.id,
        payment_method: 'cod'
      })
    expect(res.status).toBe(201)
    // 地址信息以**已保存地址**为准（表单里填的被覆盖）
    const data = res.body.data.order || res.body.data
    expect(data.delivery_address).toContain('测试路 9 号')
    expect(data.postal_code).toBe('10400')
  })

  it('OR-2 用别人的地址下单 → 400（越权）', async () => {
    const { Address } = TestDatabase.getSequelize().models
    const other = await User_create()
    const otherAddress = await Address.create({
      user_id: other.id,
      contact_name: '别人',
      contact_phone: '13899998888',
      province: 'A',
      city: 'B',
      district: 'C',
      postal_code: '10000',
      detail_address: '别人的地址',
      full_address: 'A B C 别人的地址'
    })

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${TestHelpers.generateToken(user)}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '表单联系人',
        contact_phone: '13800001111',
        delivery_address: '表单里的地址',
        address_id: otherAddress.id,
        payment_method: 'cod'
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/地址/)
  })
})

describe('订单列表关键词搜索', () => {
  it('OR-3 关键词搜索：命中单号/收货人/电话/用户昵称', async () => {
    const order = await makeOrder({ contact_name: ' searchable名字 ' })
    // 让用户的昵称可搜
    await user.update({ nickname: '可搜昵称' })

    for (const keyword of [order.order_no, 'searchable名字', '13800000000', '可搜昵称']) {
      const res = await request(app)
        .get(`/api/admin/orders?keyword=${encodeURIComponent(keyword)}`)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status, keyword).toBe(200)
      expect(res.body.data.orders.length, keyword).toBeGreaterThan(0)
      expect(res.body.data.orders.some(o => o.id === order.id), keyword).toBe(true)
    }
  })

  it('OR-4 关键词搜索：没有命中 → 空列表（不报错）', async () => {
    await makeOrder()
    const res = await request(app)
      .get('/api/admin/orders').query({ keyword: '绝对不存在的关键词zzz' })
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.orders).toEqual([])
  })
})

describe('订单详情', () => {
  it('OR-5 订单详情带推荐人信息', async () => {
    const { User } = TestDatabase.getSequelize().models
    const referrer = await User.create(await TestDataFactory.createUser({
      nickname: '推荐人', country_code: '+86', phone: '13700001111'
    }))
    await user.update({ referred_by_code: referrer.referral_code })

    const order = await makeOrder()
    const res = await request(app)
      .get(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.user.referrer).toBeTruthy()
    expect(res.body.data.user.referrer.nickname).toBe('推荐人')
  })

  it('OR-6 订单详情：别人的订单（用户端）→ 404', async () => {
    const other = await User_create()
    const order = await makeOrder({ user_id: other.id })
    const res = await request(app)
      .get(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${TestHelpers.generateToken(user)}`)
    expect(res.status).toBe(404)
  })
})

describe('改订单状态', () => {
  it('OR-7 非法 id → 400', async () => {
    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await request(app)
        .put(`/api/admin/orders/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'shipped' })
      expect(res.status, id).toBe(400)
    }
  })

  it('OR-8 不合法的流转 → 400', async () => {
    const order = await makeOrder({ status: 'pending' })
    // pending 不能直接到 shipped（状态机不允许）
    const res = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'shipped' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/不允许/)
  })

  it('OR-9 订单不存在 → 404', async () => {
    const res = await request(app)
      .put('/api/admin/orders/999999/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'shipped' })
    expect(res.status).toBe(404)
  })

  it('OR-10 取消订单 → 库存回补', async () => {
    const order = await makeOrder({ status: 'pending' })
    const stockBefore = (await productModel.findByPk(product.id)).stock

    const res = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'cancelled' })
    expect(res.status).toBe(200)

    const stockAfter = (await productModel.findByPk(product.id)).stock
    expect(stockAfter).toBe(stockBefore + 2) // 订了 2 件 → 取消后回补 2
  })
})
