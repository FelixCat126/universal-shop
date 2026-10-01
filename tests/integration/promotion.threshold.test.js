/**
 * P1 营销体系 — 满减 + quote + 积分按实付（8 用例）
 *
 *   PM-1 满减命中：100×2 件 + tiers[{min:150,off:30}] → payable=170、discount_amount=30、
 *        order_promotions 有快照、行分摊合计=30
 *   PM-2 未达门槛：无优惠
 *   PM-3 scope=category 只算范围内商品
 *   PM-4 积分换购单不参与促销：payment_method=points 时 discount_amount=0
 *   PM-5 积分按实付：100 THB COD 单 rate=0.01（默认回退）→ 发 1 积分；取消后收回 1
 *   PM-6 quote 接口：结构字段断言 + 下架商品 400
 *   PM-7 过期/未开始/停用 promotion 不生效
 *   PM-8 admin 促销 CRUD 校验：off>=min 400 / scope 缺 ids 400 / 创建 201 / 状态切换 / 删除
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

// 直接落库一条满减（不经 admin API；PM-1/PM-8 走接口）
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

const ORDER_BODY = {
  contact_name: '收货人',
  contact_phone: '+8613900000777',
  delivery_address: '某街区 1 号'
}

async function createCodOrder (token, items) {
  return request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...ORDER_BODY, items, payment_method: 'cod' })
}

describe('P1.promotion.threshold — 满减计价', () => {
  it('PM-1 满减命中：payable=170、discount_amount=30、快照落库、行分摊合计=30', async () => {
    const { token } = await userWithToken()
    const admin = await adminToken()
    const p = await activeProduct()

    // 经 admin API 建促销（同时覆盖 POST /api/admin/promotions happy）
    const promoRes = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '满150减30', rules: { tiers: [{ min: 150, off: 30 }] }, scope: { type: 'all' } })
    expect(promoRes.status).toBe(201)
    const promotionId = promoRes.body.data.id

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.total_amount_thb)).toBe(170)
    expect(Number(order.discount_amount)).toBe(30)

    // 促销快照：一单一条
    const { OrderPromotion, OrderItem } = sequelize.models
    const snaps = await OrderPromotion.findAll({ where: { order_id: order.id } })
    expect(snaps.length).toBe(1)
    expect(snaps[0].promotion_id).toBe(promotionId)
    expect(snaps[0].name).toBe('满150减30')
    expect(Number(snaps[0].amount)).toBe(30)

    // 行分摊：单行（quantity=2）全额承担 30；分摊合计 = 订单减免合计
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    expect(rows.length).toBe(1)
    const allocSum = rows.reduce((s, it) => s + Number(it.discount_allocated), 0)
    expect(Math.round(allocSum * 100) / 100).toBe(30)
    expect(Number(rows[0].discount_allocated)).toBe(30)
  })

  it('PM-2 未达门槛：无优惠', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    await createThresholdPromotion({ rules: { tiers: [{ min: 1000, off: 100 }] } })

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.total_amount_thb)).toBe(200)
    expect(Number(order.discount_amount)).toBe(0)

    const { OrderPromotion } = sequelize.models
    expect(await OrderPromotion.count({ where: { order_id: order.id } })).toBe(0)
  })

  it('PM-3 scope=category 只算范围内商品', async () => {
    const { token } = await userWithToken()
    const { ProductCategory } = sequelize.models
    const catA = await ProductCategory.create({ name: '食品A', sort_order: 1 })
    const catB = await ProductCategory.create({ name: '饮料B', sort_order: 2 })
    const pA = await activeProduct({ category_id: catA.id })
    const pB = await activeProduct({ category_id: catB.id })
    await createThresholdPromotion({ scope: { type: 'category', ids: [catA.id] } })

    // A×2 = 200（范围内，达 150 门槛），B×1 = 100（范围外）→ 满减 30 全摊给 A 行
    const res = await createCodOrder(token, [
      { product_id: pA.id, quantity: 2 },
      { product_id: pB.id, quantity: 1 }
    ])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.discount_amount)).toBe(30)
    expect(Number(order.total_amount_thb)).toBe(270)

    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    const rowA = rows.find(r => r.product_id === pA.id)
    const rowB = rows.find(r => r.product_id === pB.id)
    expect(Number(rowA.discount_allocated)).toBe(30)
    expect(Number(rowB.discount_allocated)).toBe(0)
  })

  it('PM-4 积分换购单不参与促销：discount_amount=0', async () => {
    const { user, token } = await userWithToken()
    const p = await activeProduct({ points: 10 })
    // 门槛 50 减免 10：若促销生效本应收 90 口径，积分单必须完全不命中
    await createThresholdPromotion({ rules: { tiers: [{ min: 50, off: 10 }] } })
    await TestHelpers.topUpUserPoints(user, 100)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...ORDER_BODY, items: [{ product_id: p.id, quantity: 1 }], payment_method: 'points' })
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.discount_amount)).toBe(0)

    const { OrderPromotion, UserPointBalance } = sequelize.models
    expect(await OrderPromotion.count({ where: { order_id: order.id } })).toBe(0)

    // 积分照扣（10/件 × 1），不受促销影响
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(bal.balance)).toBe(90)
  })

  it('PM-5 积分按实付：100 THB COD 单发 1 积分，取消后收回 1', async () => {
    const { user, token } = await userWithToken()
    const admin = await adminToken()
    const p = await activeProduct()

    // 未配置 points_earn_rate → 回退默认 0.01：floor(100 × 0.01) = 1
    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 1 }])
    expect(res.status).toBe(201)
    const orderId = res.body.data.order.id

    const { UserPointBalance, PointTransaction } = sequelize.models
    const after1 = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(after1.balance)).toBe(1)

    // admin 取消：收回已发购物积分
    const cancel = await request(app)
      .put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'cancelled' })
    expect(cancel.status).toBe(200)

    const after2 = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(after2.balance)).toBe(0)
    const revokeTx = await PointTransaction.findOne({
      where: { order_id: orderId, type: 'revoke_cancel' }
    })
    expect(revokeTx).not.toBeNull()
    expect(Number(revokeTx.delta)).toBe(-1)
  })

  it('PM-6 quote 接口：结构字段断言 + 下架商品 400', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    await createThresholdPromotion({ name: '满150减30' })

    const res = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: p.id, quantity: 2 }], payment_method: 'cod' })
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.items_total).toBe(200)
    expect(data.discount_amount).toBe(30)
    expect(data.payable_thb).toBe(170)
    expect(data.points_estimate).toBe(1) // floor(170 × 0.01)
    expect(data.billing).toEqual({ currency: 'THB', amount: 170, rate: 1 })
    expect(data.applied_promotions.length).toBe(1)
    expect(data.applied_promotions[0].name).toBe('满150减30')
    expect(data.applied_promotions[0].amount).toBe(30)
    expect(data.lines.length).toBe(1)
    expect(data.lines[0]).toMatchObject({
      product_id: p.id,
      quantity: 2,
      unit_price: 100,
      original_price: 100,
      line_total: 200,
      discount_allocated: 30,
      line_payable: 170
    })

    // 下架商品 → 400（消息含商品名与"已下架"）
    const off = await activeProduct({ status: 'inactive', name: '下架商品X' })
    const bad = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: off.id, quantity: 1 }] })
    expect(bad.status).toBe(400)
    expect(bad.body.message).toMatch(/下架商品X/)
    expect(bad.body.message).toMatch(/已下架/)
  })

  it('PM-7 过期/未开始/停用 promotion 不生效', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const now = Date.now()
    await createThresholdPromotion({
      name: '已过期',
      rules: { tiers: [{ min: 100, off: 10 }] },
      start_at: new Date(now - 7 * 24 * 3600 * 1000),
      end_at: new Date(now - 24 * 3600 * 1000)
    })
    await createThresholdPromotion({
      name: '未开始',
      rules: { tiers: [{ min: 100, off: 10 }] },
      start_at: new Date(now + 24 * 3600 * 1000),
      end_at: new Date(now + 7 * 24 * 3600 * 1000)
    })
    await createThresholdPromotion({
      name: '已停用',
      rules: { tiers: [{ min: 100, off: 10 }] },
      status: 'inactive'
    })

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 2 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.discount_amount)).toBe(0)
    expect(Number(order.total_amount_thb)).toBe(200)
  })
})

describe('P1.promotion.admin — 促销管理 API 边界', () => {
  it('PM-8 校验与 CRUD：off>=min 400 / scope 缺 ids 400 / 创建 201 / 状态切换 / 删除', async () => {
    const admin = await adminToken()

    // 档位 off >= min → 400
    const badTier = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '坏档位', rules: { tiers: [{ min: 100, off: 100 }] }, scope: { type: 'all' } })
    expect(badTier.status).toBe(400)

    // scope=product 缺 ids → 400
    const badScope = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '坏范围', rules: { tiers: [{ min: 100, off: 10 }] }, scope: { type: 'product' } })
    expect(badScope.status).toBe(400)

    // start_at 晚于 end_at → 400
    const badWindow = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: '坏时间窗',
        rules: { tiers: [{ min: 100, off: 10 }] },
        scope: { type: 'all' },
        start_at: '2026-02-01T00:00:00Z',
        end_at: '2026-01-01T00:00:00Z'
      })
    expect(badWindow.status).toBe(400)

    // 创建 happy → 201
    const created = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '满100减10', rules: { tiers: [{ min: 100, off: 10 }] }, scope: { type: 'all' }, priority: 5 })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    expect(created.body.data.status).toBe('active')

    // 列表可查到
    const list = await request(app)
      .get('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
    expect(list.status).toBe(200)
    expect(list.body.data.list.some(r => r.id === id)).toBe(true)

    // 全量更新
    const updated = await request(app)
      .put(`/api/admin/promotions/${id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '满100减15', rules: { tiers: [{ min: 100, off: 15 }] }, scope: { type: 'all' } })
    expect(updated.status).toBe(200)
    expect(updated.body.data.name).toBe('满100减15')

    // 状态切换
    const toggled = await request(app)
      .put(`/api/admin/promotions/${id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'inactive' })
    expect(toggled.status).toBe(200)
    expect(toggled.body.data.status).toBe('inactive')

    // 删除后列表不再出现
    const del = await request(app)
      .delete(`/api/admin/promotions/${id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(del.status).toBe(200)
    const list2 = await request(app)
      .get('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
    expect(list2.body.data.list.some(r => r.id === id)).toBe(false)
  })
})
