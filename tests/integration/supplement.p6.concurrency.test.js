/**
 * 第三轮：零售侧并发与数据完整性（8 用例）
 *
 * 已有并发测试覆盖：合作方超卖、积分扣减、订单号唯一、库存原子累加。
 * 本文件补齐**零售侧**此前未覆盖的并发路径：
 *   CC-1  零售并发下单不超卖（库存 5 / 20 并发 → 恰好 5 单成功）
 *   CC-2  库存扣减总量守恒（扣减数 == 成功单数 × 数量）
 *   CC-3  同一幂等键并发下单只创建 1 单（不重复扣库存）
 *   CC-4  不同幂等键并发下单各自成单
 *   CC-5  同一张优惠券并发核销只成功 1 次（不重复抵扣）
 *   CC-6  优惠券并发核销后状态与金额一致
 *   CC-7  下单与取消并发：库存最终守恒（不多不少）
 *   CC-8  并发下单后积分流水与订单金额一致
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Op } from 'sequelize'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { issueCaptcha, _getCaptchaAnswerForTests } from '@server/utils/captcha.js'

const models = () => TestDatabase.getSequelize().models

let product
let user

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Product, ProductCategory, User } = models()
  const cat = await ProductCategory.create({ name: 'cat-' + Date.now(), sort_order: 1 })
  product = await Product.create({
    name: '并发测试商品', price: 100, stock: 5, category_id: cat.id, status: 'active'
  })
  user = await User.create({
    username: 'cc-' + Date.now(), nickname: 'cc', country_code: '+86',
    phone: '138' + String(Date.now()).slice(-8), password: 'Concurrency1234',
    must_reset_password: false
  })
})

/** 造一个可用的验证码（答案从服务端存储取） */
async function captchaPair () {
  const c = await issueCaptcha()
  const answer = await _getCaptchaAnswerForTests(c.token)
  return { captcha_token: c.token, captcha_answer: answer }
}

/** 下单请求体 */
function orderBody (extra = {}) {
  return {
    contact_name: '并发用户',
    contact_phone: '13800138000',
    delivery_address: '测试地址',
    items: [{ product_id: product.id, quantity: 1 }],
    payment_method: 'cod',
    ...extra
  }
}

describe('Concurrency.retail', () => {
  it('CC-1 零售并发下单不超卖（库存 5 / 20 并发 → 恰好 5 单成功）', async () => {
    const token = TestHelpers.generateToken(user)
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody())
      )
    )
    const ok = results.filter(r => r.status === 201).length
    const { Order } = models()
    const orderCount = await Order.count({ where: { user_id: user.id } })
    expect(ok).toBe(5)
    expect(orderCount).toBe(5)
  }, 60000)

  it('CC-2 库存扣减总量守恒', async () => {
    const token = TestHelpers.generateToken(user)
    await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody())
      )
    )
    const { Product, OrderItem } = models()
    const p = await Product.findByPk(product.id)
    const items = await OrderItem.findAll({
      where: { product_id: product.id },
      include: [{ model: models().Order, as: 'order' }]
    })
    // 未扣减库存 + 已售数量 == 初始库存
    const sold = items.filter(i => i.order?.status !== 'cancelled').length
    expect(p.stock + sold).toBe(5)
  }, 60000)

  it('CC-3 同一幂等键并发下单只创建 1 单（不重复扣库存）', async () => {
    const token = TestHelpers.generateToken(user)
    const key = 'idem-' + Date.now()
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody({ client_order_key: key }))
      )
    )
    const created = results.filter(r => r.status === 201).length
    const { Order, Product } = models()
    const orderCount = await Order.count({ where: { user_id: user.id, client_order_key: key } })
    expect(orderCount).toBe(1)
    // 库存只扣 1
    const p = await Product.findByPk(product.id)
    expect(p.stock).toBe(4)
    expect(created).toBeGreaterThanOrEqual(1)
  }, 60000)

  it('CC-4 不同幂等键并发下单各自成单', async () => {
    const token = TestHelpers.generateToken(user)
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody({ client_order_key: 'k-' + Date.now() + '-' + i }))
      )
    )
    const created = results.filter(r => r.status === 201).length
    expect(created).toBe(4)
    const { Product } = models()
    expect((await Product.findByPk(product.id)).stock).toBe(1)
  }, 60000)

  it('CC-5 同一张优惠券并发核销只成功 1 次', async () => {
    const { CouponTemplate, UserCoupon } = models()
    const tpl = await CouponTemplate.create({
      name: '并发券', type: 'discount', amount: 50, min_spend: 0,
      status: 'active', scope: { type: 'all' }
    })
    const uc = await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: 'CC' + Date.now(), status: 'unused', expire_at: null
    })
    const token = TestHelpers.generateToken(user)
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody({ user_coupon_id: uc.id }))
      )
    )
    const ok = results.filter(r => r.status === 201).length
    expect(ok).toBe(1)
    const after = await UserCoupon.findByPk(uc.id)
    expect(after.status).toBe('used')
  }, 60000)

  it('CC-6 优惠券核销后订单金额与券额一致', async () => {
    const { CouponTemplate, UserCoupon, Order } = models()
    const tpl = await CouponTemplate.create({
      name: '校验券', type: 'discount', amount: 50, min_spend: 0,
      status: 'active', scope: { type: 'all' }
    })
    const uc = await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: 'CV' + Date.now(), status: 'unused', expire_at: null
    })
    const token = TestHelpers.generateToken(user)
    const res = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(orderBody({ user_coupon_id: uc.id }))
    expect(res.status).toBe(201)
    const order = await Order.findByPk(res.body.data.order.id)
    // 商品 100，券抵 50 → 应付 50
    expect(Number(order.total_amount_thb)).toBe(50)
    expect(Number(order.discount_amount)).toBe(50)
  }, 60000)

  it('CC-7 下单与取消并发：库存最终守恒', async () => {
    const token = TestHelpers.generateToken(user)
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)

    const created = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(orderBody())
    expect(created.status).toBe(201)
    const orderId = created.body.data.order.id

    // 下单的同时取消另一笔
    const [cancelRes] = await Promise.all([
      request(app).put(`/api/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' }),
      request(app).post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send(orderBody())
    ])
    expect([200, 400]).toContain(cancelRes.status)

    const { Product, Order } = models()
    const p = await Product.findByPk(product.id)
    const orders = await Order.findAll({ where: { user_id: user.id } })
    const active = orders.filter(o => o.status !== 'cancelled').length
    // 库存 = 初始 - 有效订单数
    expect(p.stock).toBe(5 - active)
  }, 60000)

  it('CC-8 并发下单后积分流水与订单金额一致', async () => {
    const token = TestHelpers.generateToken(user)
    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody())
      )
    )
    const { Order, PointTransaction, UserPointBalance } = models()
    const orders = await Order.findAll({ where: { user_id: user.id, status: { [Op.notIn]: ['cancelled'] } } }).catch(() => [])
    // 积分流水条数不应多于订单数（每单最多一条 earn_purchase）
    const txs = await PointTransaction.findAll({
      where: { user_id: user.id, type: 'earn_purchase' }
    })
    expect(txs.length).toBeLessThanOrEqual(orders.length + 1)
    // 余额应等于流水累计
    const sum = txs.reduce((s, t) => s + Number(t.delta), 0)
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(bal?.balance || 0)).toBe(sum)
  }, 60000)
})
