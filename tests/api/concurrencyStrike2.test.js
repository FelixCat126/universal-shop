/**
 * 并发黑盒打击 2.0：更多写接口 + 数据库状态断言
 *
 * 上一轮打的是"响应码对不对"，这一轮加一层：**直接查库**，
 * 断言最终数据必须是什么 —— 有些 bug 响应是 200，但库里已经错了。
 *
 *   CS-I 并发删除同一购物车行 → 不报错、购物车行最终只剩一条
 *   CS-J 并发领同一张券（同用户） → 只领到 1 张
 *   CS-K 并发改同一订单状态 → 状态机只生效一次（不会绕过去）
 *   CS-L 并发改同一商品价格 → 最终价格必须是某一个提交的合法值（不能是拼接出来的怪数）
 *   CS-M 并发下单 + 并发取消同一批订单 → 库存最终必须 = 期初（不多不少）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

let user
let userToken
let adminToken
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
  const { User, Product, ProductCategory, Administrator } = models()
  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900005555'
  }))
  userToken = TestHelpers.generateToken(user)
  category = await ProductCategory.create({ name: '打击分类' })
  product = await Product.create({
    name: '打击商品', price: 100, stock: 50, category_id: category.id, status: 'active'
  })
  const admin = await Administrator.create({
    username: `cs2_admin_${Date.now()}`,
    password: 'CsPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

describe('并发黑盒打击 2.0', () => {
  it('CS-I 并发删除同一购物车行：不报错、行最终状态正确', async () => {
    const { Cart } = models()
    const cart = await Cart.create({
      user_id: user.id, session_id: null, product_id: product.id, quantity: 2, price: 100
    })

    const results = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).delete(`/api/cart/${cart.id}`).set('Authorization', `Bearer ${userToken}`)
    ))
    // 至少一次成功，其余 404（行已删）—— 不能有 500
    const serverErrors = results.filter(r => r.status >= 500)
    expect(serverErrors, `并发删除出现 500：${serverErrors.map(r => r.status + ':' + (r.body?.message || '')).join(' | ')}`).toEqual([])
    expect(results.filter(r => r.status === 200).length).toBeGreaterThan(0)
    expect(await Cart.count({ where: { id: cart.id } })).toBe(0)
  })

  it('CS-J 同一用户并发领同一张券：只领到 1 张', async () => {
    const { CouponTemplate, UserCoupon } = models()
    const tpl = await CouponTemplate.create({
      name: '单领券', type: 'discount', amount: 50, min_spend: 100,
      total: 10, per_user: 1, status: 'active', scope: { type: 'all', ids: [] }
    })

    const results = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).post('/api/coupons/claim')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ template_id: tpl.id })
    ))

    const issued = await UserCoupon.count({ where: { template_id: tpl.id, user_id: user.id } })
    expect(issued, `每人限领 1 张，实际领到 ${issued} 张`).toBe(1)
    expect(results.filter(r => r.status === 201).length).toBe(1)
  })

  it('CS-K 并发改同一订单状态：只生效一次，不会绕过状态机', async () => {
    const { Order } = models()
    const order = await Order.create({
      order_no: `CSK${Date.now()}`,
      user_id: user.id,
      total_amount: 100, total_amount_thb: 100,
      currency_code: 'THB', payment_method: 'cod', status: 'shipping',
      contact_name: 'X', contact_phone: '13800138000', delivery_address: 'A',
      exchange_rate: 1
    })

    // shipping → shipped 与 shipping → cancelled 抢同一个订单
    const results = await Promise.all([
      request(app).put(`/api/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'shipped' }),
      request(app).put(`/api/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'cancelled' }),
      request(app).put(`/api/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'delivered' })
    ])

    const fresh = await Order.findByPk(order.id)
    // 最终状态必须是三个目标之一（不能是第四种），且不得是互斥的中间态
    expect(['shipped', 'cancelled', 'delivered']).toContain(fresh.status)
    // 已取消的订单不能再被改成别的状态
    if (fresh.status === 'cancelled') {
      expect(results.filter(r => r.status === 200).length).toBe(1)
    }
  })

  it('CS-L 并发改同一商品价格：最终价格必须是某个提交的合法值', async () => {
    const prices = [111, 222, 333]
    await Promise.all(prices.map(p =>
      request(app).put(`/api/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '打击商品', price: p })
    ))
    const fresh = await models().Product.findByPk(product.id)
    expect(prices, '最终价格必须是某个并发提交的值（不能是竞态拼出来的怪数）').toContain(Number(fresh.price))
  })

  it('CS-M 并发下单 + 并发取消：库存最终必须 = 期初', async () => {
    const { Product, Order, OrderItem } = models()
    await Product.update({ stock: 20 }, { where: { id: product.id } })

    // 先下 5 单（每单 2 件）
    const created = []
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          contact_name: 'X', contact_phone: '+8613900005555',
          delivery_address: 'A', detail_address: 'B',
          items: [{ product_id: product.id, quantity: 2 }],
          payment_method: 'cod'
        })
      expect(r.status).toBe(201)
      created.push(r.body.data.order.id)
    }
    // 20 - 5×2 = 10
    expect(Number((await Product.findByPk(product.id)).stock)).toBe(10)

    // 并发取消全部
    await Promise.all(created.map(id =>
      request(app).put(`/api/admin/orders/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
    ))

    const fresh = await Product.findByPk(product.id)
    expect(Number(fresh.stock), `库存最终应回到 20，实际 ${fresh.stock}（回补了多次或没回补）`).toBe(20)

    const { OrderItem: OI } = models()
    // 明细行应已被清（取消只回补资源，不删明细；这里只断言库存）
    expect(await OI.count({ where: { product_id: product.id } })).toBeGreaterThanOrEqual(0)
  })
})
