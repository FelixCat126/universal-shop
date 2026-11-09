/**
 * 订单试算 / 优惠校验 / 删除 的边界与故障分支
 *
 * 这些是"下单前的最后一道闸" —— 校验错了就是**金额算错**（真金白银）。
 *
 *   OQ-1 试算：用抵扣券但没登录 → 400
 *   OQ-2 试算：用**别人**的抵扣券 → 400
 *   OQ-3 试算：积分换购 + 抵扣券（互斥）→ 400
 *   OQ-4 试算：币种没配置汇算比例 → 400
 *   OQ-5 下单：积分换购 + 抵扣券（互斥）→ 400
 *   OQ-6 删除订单：不存在 → 404
 *   OQ-7 试算：计价引擎内部错误 → 500（不是"成功返回 0 元"）
 *   OQ-8 我的订单列表查询失败 → 500
 *   OQ-9 订单详情查询失败 → 500
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { injectFault, restoreFaults } from '../helpers/faultInjection.js'

let user
let token
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models
  category = await ProductCategory.create({ name: '试算测试分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '试算测试商品', price: 100, stock: 500, category_id: category.id
  }))
  user = await models.User.create(await TestDataFactory.createUser({
    nickname: '试算测试用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: `oq${Date.now()}@example.com`
  }))
  token = TestHelpers.generateToken(user)
})

afterEach(() => {
  restoreFaults()
})

/** 造一张用户券 */
async function makeCoupon (overrides = {}) {
  const { UserCoupon, CouponTemplate } = TestDatabase.getSequelize().models
  const template = await CouponTemplate.create({
    name: '测试券',
    amount: 10,
    min_spend: 50,
    total: 100,
    per_user: 1,
    scope: 'all',
    status: 'active',
    valid_from: new Date(Date.now() - 86400000),
    valid_to: new Date(Date.now() + 86400000)
  })
  return UserCoupon.create({
    template_id: template.id,
    user_id: user.id,
    code: `C${Date.now()}${Math.floor(Math.random() * 1000)}`,
    status: 'unused',
    expire_at: new Date(Date.now() + 86400000),
    ...overrides
  })
}

describe('订单试算的优惠与币种校验', () => {
  it('OQ-1 试算：用抵扣券但没登录 → 400', async () => {
    const coupon = await makeCoupon()
    const res = await request(app).post('/api/orders/quote').send({
      items: [{ product_id: product.id, quantity: 1 }],
      user_coupon_id: coupon.id
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/登录/)
  })

  it('OQ-2 试算：用别人的抵扣券 → 400', async () => {
    const { User, UserCoupon, CouponTemplate } = TestDatabase.getSequelize().models
    const other = await User.create(await TestDataFactory.createUser({
      nickname: '别人', country_code: '+86', phone: '13800009999'
    }))
    const template = await CouponTemplate.create({
      name: '别人的券', amount: 10, min_spend: 50, total: 100,
      per_user: 1, scope: 'all', status: 'active'
    })
    const otherCoupon = await UserCoupon.create({
      template_id: template.id, user_id: other.id,
      code: `OC${Date.now()}`, status: 'unused'
    })

    const res = await request(app).post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 1 }], user_coupon_id: otherCoupon.id })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/不属于当前用户|不存在/)
  })

  it('OQ-3 试算：积分换购 + 抵扣券（互斥）→ 400', async () => {
    const coupon = await makeCoupon()
    const res = await request(app).post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        payment_method: 'points',
        user_coupon_id: coupon.id
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/不可使用抵扣券/)
  })

  it('OQ-4 试算：币种没配置汇算比例 → 400', async () => {
    const res = await request(app).post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        payment_method: 'cod',
        checkout_currency: 'XXX'
      })
    expect(res.status).toBe(400)
    // 校验可能发生在 joi 层（币种枚举）或控制器层（没配汇算比例）——
    // 两种都是对的拒绝，这里只要求"明确报错"而不是"放行"
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/checkout_currency|币种|汇算/)
  })
})

describe('下单的互斥校验', () => {
  it('OQ-5 下单：积分换购 + 抵扣券（互斥）→ 400', async () => {
    const coupon = await makeCoupon()
    const res = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '收货人',
        contact_phone: '13800000000',
        delivery_address: '测试地址',
        payment_method: 'points',
        user_coupon_id: coupon.id
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/不可使用抵扣券/)
  })
})

describe('订单删除与故障分支', () => {
  it('OQ-6 删除订单：不存在 → 404', async () => {
    const res = await request(app)
      .delete('/api/admin/orders/999999')
      .set('Authorization', `Bearer ${(await makeAdmin()).token}`)
    expect(res.status).toBe(404)
  })

  it('OQ-7 试算：计价引擎内部错误 → 500（不是"成功返回 0 元"）', async () => {
    const { Product } = TestDatabase.getSequelize().models
    injectFault(Product, 'findAll', new Error('db down'))

    const res = await request(app).post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 1 }] })
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })

  it('OQ-8 我的订单列表查询失败 → 500', async () => {
    const { Order } = TestDatabase.getSequelize().models
    injectFault(Order, 'findAll', new Error('db down'))

    const res = await request(app)
      .get('/api/orders').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(500)
  })

  it('OQ-9 订单详情查询失败 → 500', async () => {
    const { Order } = TestDatabase.getSequelize().models
    injectFault(Order, 'findOne', new Error('db down'))

    const res = await request(app)
      .get('/api/orders/999999').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(500)
  })
})

/** 造一个管理员 */
async function makeAdmin () {
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `oq_admin_${Date.now()}`,
    password: 'OqPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}
