/**
 * P2 抵扣券全链路（8 用例）
 *
 *   CP-1 admin 模板 CRUD + 校验（面额>门槛拒 / 时间窗颠倒拒 / per_user 0 拒 / 创建 201 /
 *        列表带统计 / 全量更新 / 状态切换 / 实例列表 / 删除）
 *   CP-2 用户领取：正常 201（code 格式）/ 超 per_user 400 / 超 total 400 / 过期模板 400；
 *        available 列表的 remaining / claimed_by_me 口径
 *   CP-3 注册赠券：register_gift 模板自动发到新用户；非赠券模板不发
 *   CP-4 quote 带券：满减+券叠加（100×2=200，满150减30，券20门槛100 → payable=150）
 *   CP-5 下单用券：discount_amount=50、order_promotions 两条（满减+券）、券变 used
 *   CP-6 取消订单释放券：status 回 unused、used_by_order_id 置空
 *   CP-7 points 单用券 → 400
 *   CP-8 同券重复使用：第二次下单用同券 400
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

let sequelize

beforeEach(async () => {
  sequelize = TestDatabase.getSequelize()
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
})

async function userWithToken () {
  const { User } = sequelize.models
  const u = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    })
  )
  return { user: u, token: TestHelpers.generateToken(u) }
}

async function adminToken () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return TestHelpers.generateAdminToken(admin)
}

async function activeProduct (overrides = {}) {
  const { Product } = sequelize.models
  return Product.create(
    TestDataFactory.createProduct({ stock: 50, status: 'active', price: 100, discount: null, ...overrides })
  )
}

// 直接落库满减（与 P1 测试同手法）
async function createThresholdPromotion (overrides = {}) {
  const { Promotion } = sequelize.models
  return Promotion.create({
    type: 'threshold',
    name: '满减测试',
    rules: { tiers: [{ min: 150, off: 30 }] },
    scope: { type: 'all', ids: [] },
    priority: 0,
    status: 'active',
    ...overrides
  })
}

// 直接落库券模板（CP-1 走 admin API）
async function createCouponTemplate (overrides = {}) {
  const { CouponTemplate } = sequelize.models
  return CouponTemplate.create({
    name: '立减20券',
    amount: 20,
    min_spend: 100,
    total: null,
    per_user: 1,
    scope: { type: 'all', ids: [] },
    status: 'active',
    ...overrides
  })
}

const ORDER_BODY = {
  contact_name: '收货人',
  contact_phone: '+8613900000777',
  delivery_address: '某街区 1 号'
}

async function createCodOrder (token, items, extra = {}) {
  return request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...ORDER_BODY, items, payment_method: 'cod', ...extra })
}

async function claimCoupon (token, templateId) {
  return request(app)
    .post('/api/coupons/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({ template_id: templateId })
}

describe('P2.coupon.admin — 券模板管理 API', () => {
  it('CP-1 校验与 CRUD：面额>门槛 400 / 时间窗颠倒 400 / per_user 0 400 / 创建 201 / 统计 / 更新 / 状态 / 实例 / 删除', async () => {
    const admin = await adminToken()

    // 面额 > 使用门槛（min_spend>0 时）→ 400
    const badAmount = await request(app)
      .post('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '坏面额', amount: 30, min_spend: 20 })
    expect(badAmount.status).toBe(400)

    // valid_from 晚于 valid_to → 400
    const badWindow = await request(app)
      .post('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: '坏时间窗',
        amount: 10,
        valid_from: '2026-02-01T00:00:00Z',
        valid_to: '2026-01-01T00:00:00Z'
      })
    expect(badWindow.status).toBe(400)

    // per_user = 0 → 400
    const badPerUser = await request(app)
      .post('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '坏限领', amount: 10, per_user: 0 })
    expect(badPerUser.status).toBe(400)

    // 缺 name → 400
    const noName = await request(app)
      .post('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
      .send({ amount: 10 })
    expect(noName.status).toBe(400)

    // 创建 happy → 201
    const created = await request(app)
      .post('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '满100减20', amount: 20, min_spend: 100, per_user: 2, total: 100 })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    expect(created.body.data.status).toBe('active')
    expect(Number(created.body.data.amount)).toBe(20)

    // 列表带统计
    const list = await request(app)
      .get('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
    expect(list.status).toBe(200)
    const row = list.body.data.list.find(r => r.id === id)
    expect(row).toBeTruthy()
    expect(row.issued_count).toBe(0)
    expect(row.used_count).toBe(0)

    // 全量更新
    const updated = await request(app)
      .put(`/api/admin/coupon-templates/${id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '满100减25', amount: 25, min_spend: 100, per_user: 1 })
    expect(updated.status).toBe(200)
    expect(updated.body.data.name).toBe('满100减25')

    // 状态切换
    const toggled = await request(app)
      .put(`/api/admin/coupon-templates/${id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'inactive' })
    expect(toggled.status).toBe(200)
    expect(toggled.body.data.status).toBe('inactive')

    // 实例列表（空）
    const instances = await request(app)
      .get(`/api/admin/coupon-templates/${id}/instances`)
      .set('Authorization', `Bearer ${admin}`)
    expect(instances.status).toBe(200)
    expect(instances.body.data.list).toEqual([])

    // 删除后列表不再出现
    const del = await request(app)
      .delete(`/api/admin/coupon-templates/${id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(del.status).toBe(200)
    const list2 = await request(app)
      .get('/api/admin/coupon-templates')
      .set('Authorization', `Bearer ${admin}`)
    expect(list2.body.data.list.some(r => r.id === id)).toBe(false)
  })
})

describe('P2.coupon.claim — 用户领取', () => {
  it('CP-2 正常领取 / 超 per_user / 超 total / 过期模板 / available 口径', async () => {
    const u1 = await userWithToken()
    const u2 = await userWithToken()
    const u3 = await userWithToken()
    const template = await createCouponTemplate({ per_user: 1, total: 2 })

    // available：未领取时可见，remaining=2、claimed_by_me=0
    const availBefore = await request(app)
      .get('/api/coupons/available')
      .set('Authorization', `Bearer ${u1.token}`)
    expect(availBefore.status).toBe(200)
    const availRow = availBefore.body.data.list.find(t => t.id === template.id)
    expect(availRow).toBeTruthy()
    expect(availRow.remaining).toBe(2)
    expect(availRow.claimed_by_me).toBe(0)

    // 正常领取 → 201，code = CP + 10 位大写
    const c1 = await claimCoupon(u1.token, template.id)
    expect(c1.status).toBe(201)
    expect(c1.body.data.code).toMatch(/^CP[A-Z0-9]{10}$/)
    expect(c1.body.data.status).toBe('unused')
    expect(c1.body.data.name).toBe('立减20券')
    expect(c1.body.data.amount).toBe(20)

    // 超 per_user（per_user=1）→ 400
    const c1again = await claimCoupon(u1.token, template.id)
    expect(c1again.status).toBe(400)
    expect(c1again.body.message).toMatch(/领取上限/)

    // u1 已达限领：available 中不再出现该模板
    const availAfter = await request(app)
      .get('/api/coupons/available')
      .set('Authorization', `Bearer ${u1.token}`)
    expect(availAfter.body.data.list.some(t => t.id === template.id)).toBe(false)

    // mine：flatten 模板字段
    const mine = await request(app)
      .get('/api/coupons/mine?status=unused')
      .set('Authorization', `Bearer ${u1.token}`)
    expect(mine.status).toBe(200)
    expect(mine.body.data.list.length).toBe(1)
    expect(mine.body.data.list[0].min_spend).toBe(100)

    // u2 领取成功（total=2 用尽）
    const c2 = await claimCoupon(u2.token, template.id)
    expect(c2.status).toBe(201)

    // 超 total → 400
    const c3 = await claimCoupon(u3.token, template.id)
    expect(c3.status).toBe(400)
    expect(c3.body.message).toMatch(/已被领完/)

    // 过期模板 → 400
    const expired = await createCouponTemplate({
      name: '过期券',
      valid_from: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      valid_to: new Date(Date.now() - 24 * 3600 * 1000)
    })
    const c4 = await claimCoupon(u3.token, expired.id)
    expect(c4.status).toBe(400)
    expect(c4.body.message).toMatch(/已过有效期/)

    // 停用模板 → 400
    const inactive = await createCouponTemplate({ name: '停用券', status: 'inactive' })
    const c5 = await claimCoupon(u3.token, inactive.id)
    expect(c5.status).toBe(400)
  })
})

describe('P2.coupon.registerGift — 注册赠券', () => {
  it('CP-3 register_gift 模板自动发到新用户；非赠券模板不发', async () => {
    const gift = await createCouponTemplate({
      name: '新人礼券',
      register_gift: true,
      valid_to: new Date(Date.now() + 30 * 24 * 3600 * 1000)
    })
    await createCouponTemplate({ name: '普通券', register_gift: false })

    const phone = `137${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const res = await request(app)
      .post('/api/users/register')
      .send({ nickname: '新用户', country_code: '+86', phone, password: 'Abcd1234' })
    expect(res.status).toBe(201)

    const { User, UserCoupon } = sequelize.models
    const user = await User.findOne({ where: { country_code: '+86', phone } })
    expect(user).toBeTruthy()

    const coupons = await UserCoupon.findAll({ where: { user_id: user.id } })
    expect(coupons.length).toBe(1)
    expect(coupons[0].template_id).toBe(gift.id)
    expect(coupons[0].status).toBe('unused')
    // expire_at 取模板 valid_to
    expect(new Date(coupons[0].expire_at).getTime()).toBe(new Date(gift.valid_to).getTime())
  })
})

describe('P2.coupon.pricing — 计价与下单集成', () => {
  it('CP-4 quote 带券：满减+券叠加（200 - 30满减 - 20券 = 150）', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    await createThresholdPromotion({ name: '满150减30' })
    const template = await createCouponTemplate({ amount: 20, min_spend: 100 })

    const claimed = await claimCoupon(token, template.id)
    expect(claimed.status).toBe(201)
    const couponId = claimed.body.data.id

    const res = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: p.id, quantity: 2 }],
        payment_method: 'cod',
        user_coupon_id: couponId
      })
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.items_total).toBe(200)
    expect(data.discount_amount).toBe(50)
    expect(data.payable_thb).toBe(150)
    expect(data.points_estimate).toBe(1) // floor(150 × 0.01)
    expect(data.applied_promotions.length).toBe(1)
    expect(data.applied_coupon).toMatchObject({
      user_coupon_id: couponId,
      name: '立减20券',
      amount: 20
    })
    expect(data.lines[0].discount_allocated).toBe(50)
    expect(data.lines[0].line_payable).toBe(150)

    // 未达门槛（券门槛 1000）→ 400
    const highBar = await createCouponTemplate({ name: '高门槛券', amount: 20, min_spend: 1000 })
    const claimed2 = await claimCoupon(token, highBar.id)
    expect(claimed2.status).toBe(201)
    const denied = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: p.id, quantity: 2 }],
        payment_method: 'cod',
        user_coupon_id: claimed2.body.data.id
      })
    expect(denied.status).toBe(400)
    expect(denied.body.message).toMatch(/门槛/)

    // 他人的券 → 400
    const other = await userWithToken()
    const stolen = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${other.token}`)
      .send({
        items: [{ product_id: p.id, quantity: 2 }],
        payment_method: 'cod',
        user_coupon_id: couponId
      })
    expect(stolen.status).toBe(400)
    expect(stolen.body.message).toMatch(/不属于当前用户/)
  })

  it('CP-5 下单用券：discount_amount=50、order_promotions 两条、券变 used', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const promo = await createThresholdPromotion({ name: '满150减30' })
    const template = await createCouponTemplate({ amount: 20, min_spend: 100 })
    const claimed = await claimCoupon(token, template.id)
    const couponId = claimed.body.data.id

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }], { user_coupon_id: couponId })
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.total_amount_thb)).toBe(150)
    expect(Number(order.discount_amount)).toBe(50)

    // 快照两条：满减一条（promotion_id）+ 券一条（user_coupon_id）
    const { OrderPromotion, UserCoupon } = sequelize.models
    const snaps = await OrderPromotion.findAll({ where: { order_id: order.id } })
    expect(snaps.length).toBe(2)
    const promoSnap = snaps.find(s => s.promotion_id != null)
    const couponSnap = snaps.find(s => s.user_coupon_id != null)
    expect(promoSnap.promotion_id).toBe(promo.id)
    expect(Number(promoSnap.amount)).toBe(30)
    expect(couponSnap.user_coupon_id).toBe(couponId)
    expect(couponSnap.name).toBe('立减20券')
    expect(Number(couponSnap.amount)).toBe(20)

    // 券状态：used + 绑定订单 + 核销时间
    const coupon = await UserCoupon.findByPk(couponId)
    expect(coupon.status).toBe('used')
    expect(coupon.used_by_order_id).toBe(order.id)
    expect(coupon.used_at).not.toBeNull()

    // 行分摊合计 = 50（满减 30 + 券 20）
    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    const allocSum = rows.reduce((s, it) => s + Number(it.discount_allocated), 0)
    expect(Math.round(allocSum * 100) / 100).toBe(50)
  })

  it('CP-6 取消订单释放券：status 回 unused、used_by_order_id 置空', async () => {
    const { token } = await userWithToken()
    const admin = await adminToken()
    const p = await activeProduct()
    const template = await createCouponTemplate()
    const claimed = await claimCoupon(token, template.id)
    const couponId = claimed.body.data.id

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }], { user_coupon_id: couponId })
    expect(res.status).toBe(201)
    const orderId = res.body.data.order.id

    const { UserCoupon } = sequelize.models
    expect((await UserCoupon.findByPk(couponId)).status).toBe('used')

    const cancel = await request(app)
      .put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'cancelled' })
    expect(cancel.status).toBe(200)

    const coupon = await UserCoupon.findByPk(couponId)
    expect(coupon.status).toBe('unused')
    expect(coupon.used_by_order_id).toBeNull()
    expect(coupon.used_at).toBeNull()
  })

  it('CP-7 points 单用券 → 400', async () => {
    const { user, token } = await userWithToken()
    const p = await activeProduct({ points: 10 })
    await TestHelpers.topUpUserPoints(user, 100)
    const template = await createCouponTemplate()
    const claimed = await claimCoupon(token, template.id)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ product_id: p.id, quantity: 1 }],
        payment_method: 'points',
        user_coupon_id: claimed.body.data.id
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/积分换购订单不可使用抵扣券/)
  })

  it('CP-8 同券重复使用：第二次下单用同券 400', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const template = await createCouponTemplate()
    const claimed = await claimCoupon(token, template.id)
    const couponId = claimed.body.data.id

    const first = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }], { user_coupon_id: couponId })
    expect(first.status).toBe(201)

    const second = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }], { user_coupon_id: couponId })
    expect(second.status).toBe(400)
    expect(second.body.message).toMatch(/抵扣券不可用或已被使用|抵扣券不存在/)

    // 第二次失败未建单：该用户只有 1 张订单
    const { Order } = sequelize.models
    const orders = await Order.findAll()
    expect(orders.length).toBe(1)
  })
})
