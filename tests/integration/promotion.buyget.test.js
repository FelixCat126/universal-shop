/**
 * P3 买多赠一（buy_x_get_y）— 8 用例
 *
 *   BG-1 同品买 3 赠 1：下 3 件 → OrderItem 2 行（正价 qty=3 + 赠品 qty=1 is_gift=true，
 *        合计 4 件），库存扣 4；赠品行 price/original_price=0、discount_allocated=0
 *   BG-2 买 7 件 → 赠 2（floor(7/3)=2），库存扣 9
 *   BG-3 指定其他赠品商品：扣赠品商品库存，正价品只扣购买数
 *   BG-4 admin 取消订单：赠品库存随整单回补
 *   BG-5 积分换购单无赠品（payment_method=points 整层跳过）
 *   BG-6 quote：gifts 字段正确透传；未达 buy 门槛 gifts 为空
 *   BG-7 赠品商品库存不足 → 400（消息含赠品商品名）；赠品商品下架/不存在 → 规则跳过不生效
 *   BG-8 admin 校验：全场/多品 scope 未指定赠品 → 400；buy/get 非正整数 → 400；单品 scope 缺省赠品 → 201
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

// 直接落库一条买赠（默认买 3 赠 1；BG-8 的 admin 校验走接口）
async function createBuyGetPromotion (overrides = {}) {
  const { Promotion } = sequelize.models
  return Promotion.create({
    type: 'buy_x_get_y',
    name: '买3赠1',
    rules: { buy: 3, get: 1 },
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

async function currentStock (productId) {
  const { Product } = sequelize.models
  const p = await Product.findByPk(productId)
  return Number(p.stock)
}

describe('P3.promotion.buy_x_get_y — 买多赠一', () => {
  it('BG-1 同品买 3 赠 1：正价 3 件 + 赠品 1 件（is_gift），库存扣 4', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    await createBuyGetPromotion({ scope: { type: 'product', ids: [p.id] } })

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 3 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    // 赠品不影响金额：3 × 100 = 300
    expect(Number(order.total_amount_thb)).toBe(300)
    expect(Number(order.discount_amount)).toBe(0)

    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id }, order: [['id', 'ASC']] })
    expect(rows.length).toBe(2)
    // 合计 4 件 = 正价 3 + 赠品 1
    expect(rows.reduce((s, r) => s + r.quantity, 0)).toBe(4)

    const normal = rows.find(r => !r.is_gift)
    const gift = rows.find(r => r.is_gift)
    expect(normal.quantity).toBe(3)
    expect(Number(normal.price)).toBe(100)
    expect(gift.quantity).toBe(1)
    expect(gift.product_id).toBe(p.id)
    expect(Number(gift.price)).toBe(0)
    expect(Number(gift.original_price)).toBe(0)
    expect(Number(gift.discount_allocated)).toBe(0)
    expect(gift.product_name_zh).toBe(p.name)

    // 库存 50 → 46
    expect(await currentStock(p.id)).toBe(46)

    // 响应 items 同样带 is_gift 标记
    const respItems = order.items || []
    expect(respItems.some(it => it.is_gift === true)).toBe(true)
  })

  it('BG-2 买 7 件 → 赠 2（floor(7/3)=2），库存扣 9', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    await createBuyGetPromotion({ scope: { type: 'product', ids: [p.id] } })

    const res = await createCodOrder(token, [{ product_id: p.id, quantity: 7 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order

    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    const gift = rows.find(r => r.is_gift)
    expect(gift).toBeTruthy()
    expect(gift.quantity).toBe(2)

    // 7 + 2 = 9，库存 50 → 41
    expect(await currentStock(p.id)).toBe(41)
  })

  it('BG-3 指定其他赠品商品：扣赠品商品库存，正价品只扣购买数', async () => {
    const { token } = await userWithToken()
    const pA = await activeProduct({ name: '正价商品A' })
    const pG = await activeProduct({ name: '赠品小样G', stock: 10 })
    await createBuyGetPromotion({
      rules: { buy: 3, get: 1, gift_product_id: pG.id },
      scope: { type: 'product', ids: [pA.id] }
    })

    const res = await createCodOrder(token, [{ product_id: pA.id, quantity: 3 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order

    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    expect(rows.length).toBe(2)
    const gift = rows.find(r => r.is_gift)
    expect(gift.product_id).toBe(pG.id)
    expect(gift.product_name_zh).toBe('赠品小样G')
    expect(gift.quantity).toBe(1)

    expect(await currentStock(pA.id)).toBe(47)
    expect(await currentStock(pG.id)).toBe(9)
  })

  it('BG-4 admin 取消订单：赠品库存随整单回补', async () => {
    const { token } = await userWithToken()
    const admin = await adminToken()
    const pA = await activeProduct({ name: '正价商品A' })
    const pG = await activeProduct({ name: '赠品小样G', stock: 10 })
    await createBuyGetPromotion({
      rules: { buy: 3, get: 1, gift_product_id: pG.id },
      scope: { type: 'product', ids: [pA.id] }
    })

    const res = await createCodOrder(token, [{ product_id: pA.id, quantity: 3 }])
    expect(res.status).toBe(201)
    const orderId = res.body.data.order.id
    expect(await currentStock(pA.id)).toBe(47)
    expect(await currentStock(pG.id)).toBe(9)

    const cancel = await request(app)
      .put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'cancelled' })
    expect(cancel.status).toBe(200)

    // 正价 3 + 赠品 1 全部回补
    expect(await currentStock(pA.id)).toBe(50)
    expect(await currentStock(pG.id)).toBe(10)
  })

  it('BG-5 积分换购单无赠品（points 整层跳过买赠）', async () => {
    const { user, token } = await userWithToken()
    const p = await activeProduct({ points: 10 })
    await createBuyGetPromotion({ scope: { type: 'product', ids: [p.id] } })
    await TestHelpers.topUpUserPoints(user, 100)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...ORDER_BODY, items: [{ product_id: p.id, quantity: 3 }], payment_method: 'points' })
    expect(res.status).toBe(201)
    const order = res.body.data.order

    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    expect(rows.length).toBe(1)
    expect(rows[0].is_gift).toBe(false)

    // 只扣购买数 3，无赠品扣减
    expect(await currentStock(p.id)).toBe(47)
  })

  it('BG-6 quote：gifts 字段正确透传；未达 buy 门槛 gifts 为空', async () => {
    const { token } = await userWithToken()
    const p = await activeProduct()
    const promo = await createBuyGetPromotion({ name: '买3赠1', scope: { type: 'product', ids: [p.id] } })

    const res = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: p.id, quantity: 3 }], payment_method: 'cod' })
    expect(res.status).toBe(200)
    const data = res.body.data
    // 赠品不影响金额与行结构
    expect(data.items_total).toBe(300)
    expect(data.payable_thb).toBe(300)
    expect(data.lines.length).toBe(1)
    expect(Array.isArray(data.gifts)).toBe(true)
    expect(data.gifts.length).toBe(1)
    expect(data.gifts[0]).toEqual({
      product_id: p.id,
      name: p.name,
      quantity: 1,
      promotion_id: promo.id,
      promotion_name: '买3赠1'
    })

    // 未达门槛：买 2 件无赠品
    const res2 = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: p.id, quantity: 2 }], payment_method: 'cod' })
    expect(res2.status).toBe(200)
    expect(res2.body.data.gifts).toEqual([])
  })

  it('BG-7 赠品库存不足 → 400（消息含赠品名）；赠品下架/不存在 → 规则跳过', async () => {
    const { token } = await userWithToken()

    // 1) 指定赠品库存 0 → 整单 400，消息含赠品商品名
    const pA = await activeProduct({ name: '正价商品A' })
    const pG = await activeProduct({ name: '缺货赠品G', stock: 0 })
    await createBuyGetPromotion({
      rules: { buy: 3, get: 1, gift_product_id: pG.id },
      scope: { type: 'product', ids: [pA.id] }
    })
    const res1 = await createCodOrder(token, [{ product_id: pA.id, quantity: 3 }])
    expect(res1.status).toBe(400)
    expect(res1.body.message).toMatch(/缺货赠品G/)
    // 整单回滚：正价品库存不动
    expect(await currentStock(pA.id)).toBe(50)

    // 2) 同品赠品库存不足：买 3 需扣 4，库存仅 3 → 400
    const { Promotion } = sequelize.models
    const pB = await activeProduct({ name: '同品赠品B', stock: 3 })
    await createBuyGetPromotion({ name: '同品买赠', scope: { type: 'product', ids: [pB.id] } })
    const res2 = await createCodOrder(token, [{ product_id: pB.id, quantity: 3 }])
    expect(res2.status).toBe(400)
    expect(res2.body.message).toMatch(/同品赠品B/)

    // 3) 赠品商品已下架 → 该条规则跳过，订单正常且无赠品行
    await Promotion.destroy({ where: {} })
    const pC = await activeProduct({ name: '正价商品C' })
    const pOff = await activeProduct({ name: '下架赠品C', status: 'inactive', stock: 10 })
    await createBuyGetPromotion({
      rules: { buy: 3, get: 1, gift_product_id: pOff.id },
      scope: { type: 'product', ids: [pC.id] }
    })
    const res3 = await createCodOrder(token, [{ product_id: pC.id, quantity: 3 }])
    expect(res3.status).toBe(201)
    const { OrderItem } = sequelize.models
    const rows3 = await OrderItem.findAll({ where: { order_id: res3.body.data.order.id } })
    expect(rows3.length).toBe(1)
    expect(rows3[0].is_gift).toBe(false)

    // 4) 赠品商品不存在 → 该条规则跳过，订单正常且无赠品行
    await Promotion.destroy({ where: {} })
    const pD = await activeProduct({ name: '正价商品D' })
    await createBuyGetPromotion({
      rules: { buy: 3, get: 1, gift_product_id: 999999 },
      scope: { type: 'product', ids: [pD.id] }
    })
    const res4 = await createCodOrder(token, [{ product_id: pD.id, quantity: 3 }])
    expect(res4.status).toBe(201)
    const rows4 = await OrderItem.findAll({ where: { order_id: res4.body.data.order.id } })
    expect(rows4.length).toBe(1)
    expect(rows4[0].is_gift).toBe(false)
  })
})

describe('P3.promotion.buy_x_get_y — admin 校验', () => {
  it('BG-8 全场/多品 scope 未指定赠品 → 400；buy/get 非正整数 → 400；单品 scope 缺省赠品 → 201', async () => {
    const admin = await adminToken()
    const p1 = await activeProduct()
    const p2 = await activeProduct()

    // scope=all 未指定 gift_product_id → 400
    const badAll = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'buy_x_get_y', name: '全场买赠', rules: { buy: 3, get: 1 }, scope: { type: 'all' } })
    expect(badAll.status).toBe(400)
    expect(badAll.body.message).toMatch(/必须指定赠品/)

    // scope=product 多品未指定 gift_product_id → 400
    const badMulti = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'buy_x_get_y', name: '多品买赠', rules: { buy: 3, get: 1 }, scope: { type: 'product', ids: [p1.id, p2.id] } })
    expect(badMulti.status).toBe(400)
    expect(badMulti.body.message).toMatch(/必须指定赠品/)

    // scope=category 未指定 gift_product_id → 400
    const { ProductCategory } = sequelize.models
    const cat = await ProductCategory.create({ name: '分类X', sort_order: 9 })
    const badCat = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'buy_x_get_y', name: '分类买赠', rules: { buy: 3, get: 1 }, scope: { type: 'category', ids: [cat.id] } })
    expect(badCat.status).toBe(400)
    expect(badCat.body.message).toMatch(/必须指定赠品/)

    // buy=0 → 400
    const badBuy = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'buy_x_get_y', name: '非法档位', rules: { buy: 0, get: 1 }, scope: { type: 'product', ids: [p1.id] } })
    expect(badBuy.status).toBe(400)

    // scope=product 单品缺省赠品（默认赠同品）→ 201
    const ok = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'buy_x_get_y', name: '单品买3赠1', rules: { buy: 3, get: 1 }, scope: { type: 'product', ids: [p1.id] } })
    expect(ok.status).toBe(201)
    expect(ok.body.data.type).toBe('buy_x_get_y')

    // 全场 + 显式 gift_product_id → 201
    const okAll = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'buy_x_get_y', name: '全场买3赠小样', rules: { buy: 3, get: 1, gift_product_id: p2.id }, scope: { type: 'all' } })
    expect(okAll.status).toBe(201)

    // threshold 原有校验不受影响（off >= min 仍 400）
    const badTier = await request(app)
      .post('/api/admin/promotions')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '坏档位', rules: { tiers: [{ min: 100, off: 100 }] }, scope: { type: 'all' } })
    expect(badTier.status).toBe(400)
  })
})
