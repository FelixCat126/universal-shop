/**
 * 强制改密守卫测试
 *
 * 守卫要拦的是**账号级操作**（改资料/注销/售后/确认支付），
 * 绝不能拦**购物流程**（加购/下单/看订单）——
 * 游客自动注册的账号也带 must_reset_password=true，
 * 拦了下单就是"把回头客赶走"。
 *
 *   PG-1 改了资料 → 403 PASSWORD_CHANGE_REQUIRED
 *   PG-2 注销账号 → 403
 *   PG-3 发起售后 → 403
 *   PG-4 确认支付 → 403
 *   PG-5 改密码 → **放行**（就是它要引导用户去的地方）
 *   PG-6 看自己的资料 → 放行
 *   PG-7 加购/下单 → 放行（购物流程不受影响）
 *   PG-8 改完密码后 → 账号级操作恢复正常
 *   PG-9 没有该标记的普通用户 → 一律放行
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let user
let token
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { _clearResetFlagCacheForTests } = await import('@server/middlewares/passwordChangeGuard.js')
  await _clearResetFlagCacheForTests()

  const models = TestDatabase.getSequelize().models
  const { Product: ProductModel, ProductCategory } = models
  category = await ProductCategory.create({ name: '改密守卫分类' })
  product = await ProductModel.create(TestDataFactory.createProduct({
    name: '改密守卫商品', price: 50, stock: 100, category_id: category.id
  }))
  user = await models.User.create(await TestDataFactory.createUser({
    nickname: '改密守卫用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: `pg${Date.now()}@example.com`
  }))
  token = TestHelpers.generateToken(user)
})

/** 给账号打上"必须改密"标记 */
async function markMustReset () {
  const { User } = TestDatabase.getSequelize().models
  await User.update({ must_reset_password: true }, { where: { id: user.id } })
  const { _clearResetFlagCacheForTests } = await import('@server/middlewares/passwordChangeGuard.js')
  await _clearResetFlagCacheForTests()
}

describe('强制改密守卫', () => {
  it('PG-1 改了资料 → 403 PASSWORD_CHANGE_REQUIRED', async () => {
    await markMustReset()
    const res = await request(app)
      .put('/api/users/profile').set('Authorization', `Bearer ${token}`)
      .send({ nickname: '新昵称' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('PG-2 注销账号 → 403', async () => {
    await markMustReset()
    const res = await request(app)
      .post('/api/users/me/delete').set('Authorization', `Bearer ${token}`)
      .send({ password: 'Whatever#2026' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('PG-3 发起售后 → **放行**（订单级操作，游客自动注册的账号也要能走）', async () => {
    await markMustReset()
    const { Order } = TestDatabase.getSequelize().models
    const order = await Order.create({
      order_no: `PG${Date.now()}`,
      user_id: user.id,
      total_amount: 100, total_amount_thb: 100, discount_amount: 0,
      currency_code: 'THB', payment_method: 'cod', status: 'completed', exchange_rate: 1
    })
    const res = await request(app)
      .post(`/api/orders/${order.id}/after-sales`).set('Authorization', `Bearer ${token}`)
      .send({ type: 'refund', reason: '测试' })
    expect(res.status).toBe(201)
  })

  it('PG-4 确认支付 → **放行**（游客在线支付的正常流程，不能被拦）', async () => {
    await markMustReset()
    const { Order } = TestDatabase.getSequelize().models
    const order = await Order.create({
      order_no: `PG${Date.now()}P`,
      user_id: user.id,
      total_amount: 100, total_amount_thb: 100, discount_amount: 0,
      currency_code: 'THB', payment_method: 'online', status: 'pending', exchange_rate: 1
    })
    const res = await request(app)
      .post(`/api/orders/${order.id}/confirm-online-payment`).set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(200)
  })

  it('PG-5 改密码 → 放行', async () => {
    await markMustReset()
    const { User } = TestDatabase.getSequelize().models
    const fresh = await User.findByPk(user.id)
    fresh.password = 'KnownPwd#2026'
    await fresh.save()

    const res = await request(app)
      .put('/api/users/profile/password').set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'KnownPwd#2026', new_password: 'NewerPwd#2026' })
    expect(res.status).toBe(200)
  })

  it('PG-6 看自己的资料 → 放行', async () => {
    await markMustReset()
    const res = await request(app)
      .get('/api/users/profile').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('PG-7 加购/下单 → 放行（购物流程不受影响）', async () => {
    await markMustReset()

    const cart = await request(app)
      .post('/api/cart').set('Authorization', `Bearer ${token}`)
      .send({ product_id: product.id, quantity: 1 })
    expect([200, 201]).toContain(cart.status)

    const order = await request(app)
      .post('/api/orders').set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '收货人',
        contact_phone: '13800000000',
        delivery_address: '测试地址',
        payment_method: 'cod'
      })
    expect(order.status).toBe(201)
  })

  it('PG-8 改完密码后 → 账号级操作恢复正常', async () => {
    await markMustReset()
    const { User } = TestDatabase.getSequelize().models
    const fresh = await User.findByPk(user.id)
    fresh.password = 'KnownPwd#2026'
    await fresh.save()

    // 先改密（放行）
    const changed = await request(app)
      .put('/api/users/profile/password').set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'KnownPwd#2026', new_password: 'NewerPwd#2026' })
    expect(changed.status).toBe(200)

    // 改密会让 token_version 递增（旧会话失效，这是安全属性）→ 重新登录拿新 token
    const relogin = await request(app).post('/api/users/login').send({
      country_code: '+86', phone: user.phone, password: 'NewerPwd#2026'
    })
    expect(relogin.status).toBe(200)
    const newToken = relogin.body.data.token

    // 再改资料 → 应该放行了
    const res = await request(app)
      .put('/api/users/profile').set('Authorization', `Bearer ${newToken}`)
      .send({ nickname: '改密之后的新昵称' })
    expect(res.status).toBe(200)
  })

  it('PG-9 没有该标记的普通用户 → 一律放行', async () => {
    const res = await request(app)
      .put('/api/users/profile').set('Authorization', `Bearer ${token}`)
      .send({ nickname: '普通用户改昵称' })
    expect(res.status).toBe(200)
  })
})
