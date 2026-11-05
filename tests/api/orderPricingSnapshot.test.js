/**
 * 订单「计价口径快照」测试
 *
 * 订单要能自解释：事后拿到一个订单，能直接看出
 *   - 用的是哪套计价规则（pricing_version）
 *   - 命中了哪些优惠、每行折后价多少（discount_snapshot）
 *
 * 起因：计价口径改过之后，老订单的行存原价、总额存折后价，新订单反过来，
 * 光看数据分不出是哪套规则算出来的（生产有一单因此说不清金额差 30%）。
 *
 *   PS-1 下单后 pricing_version = 当前计价引擎版本
 *   PS-2 discount_snapshot 含优惠/行明细，且不含 PII
 *   PS-3 用了抵扣券时快照里有券信息
 *   PS-4 命中满减时快照里有促销信息
 *   PS-5 迁移：列被删掉后跑迁移能补回来（老库升级路径）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { PRICING_ENGINE_VERSION } from '@server/services/pricingEngine.js'
import { runMigrations } from '@server/migrations/index.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
})

async function userWithToken () {
  const { User } = models()
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  return { user: u, token: TestHelpers.generateToken(u) }
}

async function activeProduct (overrides = {}) {
  const { Product } = models()
  return Product.create(
    TestDataFactory.createProduct({ stock: 50, status: 'active', price: 100, ...overrides })
  )
}

const ORDER_BODY = {
  contact_name: '快照测试',
  contact_phone: '13800000001',
  delivery_address: 'A',
  province: '北京市',
  city: '北京市',
  district: '朝阳区',
  postal_code: '100000'
}

async function createOrder (extra = {}) {
  const { token } = await userWithToken()
  const p = await activeProduct()
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...ORDER_BODY, items: [{ product_id: p.id, quantity: 2 }], payment_method: 'cod', ...extra })
  expect(res.status).toBe(201)
  const { Order } = models()
  const order = await Order.findByPk(res.body.data.order.id)
  return { order, res, product: p, token }
}

describe('订单计价口径快照', () => {
  it('PS-1 下单后 pricing_version = 当前计价引擎版本', async () => {
    const { order } = await createOrder()
    expect(order.pricing_version).toBe(PRICING_ENGINE_VERSION)
  })

  it('PS-2 discount_snapshot 含优惠与行明细，且不含 PII', async () => {
    const { order } = await createOrder()
    const snap = order.discount_snapshot
    expect(snap).toBeTruthy()
    expect(typeof snap).toBe('object')
    expect(Array.isArray(snap.promotions)).toBe(true)
    expect(Array.isArray(snap.lines)).toBe(true)
    expect(snap.lines.length).toBe(1)
    expect(snap.lines[0].product_id).toBeTruthy()
    expect(Number(snap.lines[0].price)).toBeGreaterThan(0)
    // 快照里不该有联系人/电话这类 PII
    const text = JSON.stringify(snap)
    expect(text).not.toContain('13800000001')
    expect(text).not.toContain('快照测试')
  })

  it('PS-3 用了抵扣券时快照里有券信息', async () => {
    const { User, CouponTemplate, UserCoupon } = models()
    const user = await User.create(await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    }))
    const token = TestHelpers.generateToken(user)
    const template = await CouponTemplate.create({
      name: '快照券',
      amount: 20,
      min_spend: 100,
      total: null,
      per_user: 5,
      scope: { type: 'all', ids: [] },
      status: 'active'
    })
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'SNAPCUPTEST',
      status: 'unused'
    })
    const p = await activeProduct({ price: 100 })
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...ORDER_BODY,
        items: [{ product_id: p.id, quantity: 2 }],
        payment_method: 'cod',
        user_coupon_id: template.id
      })
    expect(res.status).toBe(201)
    const { Order } = models()
    const order = await Order.findByPk(res.body.data.order.id)
    expect(order.discount_snapshot.coupon).toBeTruthy()
    expect(order.discount_snapshot.coupon.name).toBe('快照券')
    expect(Number(order.discount_snapshot.coupon.amount)).toBe(20)
  })

  it('PS-4 命中满减时快照里有促销信息', async () => {
    const { Promotion } = models()
    // 满 100 减 30（促销规则存在 rules.tiers 里）
    await Promotion.create({
      name: '快照满减',
      type: 'threshold',
      rules: { tiers: [{ min: 100, off: 30 }] },
      scope: { type: 'all', ids: [] },
      priority: 0,
      status: 'active'
    })
    const { order } = await createOrder()
    expect(order.discount_snapshot.promotions.length).toBeGreaterThan(0)
    expect(Number(order.discount_snapshot.discount_amount)).toBeGreaterThan(0)
  })

  it('PS-5 迁移：列被删掉后跑迁移能补回来', async () => {
    const sequelize = TestDatabase.getSequelize()
    // 模拟老库（没有这两列）
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS pricing_version')
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS discount_snapshot')

    const result = await runMigrations({ sequelize })
    expect(result.failed).toBeNull()

    const cols = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'orders'
         AND column_name IN ('pricing_version','discount_snapshot')`
    )
    const list = Array.isArray(cols?.[0]) ? cols[0] : cols
    expect(list.length).toBe(2)
  })
})
