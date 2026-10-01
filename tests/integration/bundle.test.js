/**
 * P4 固定组合包（Bundle）— 7 用例
 *
 *   BD-1 admin CRUD + 校验：创建/列表/更新/状态/删除；组件不存在、价格非法、重复组件 → 400
 *   BD-2 公开列表/详情：standalone_total（组件直降价合计）与 available_stock（min floor(stock/配比)）计算；
 *        非法 id → 400，不存在/已停用 → 404
 *   BD-3 下单组合包：OrderItem 展开为组件行（带 bundle_id）、总价 = 组合价 × 数量、组件库存分别扣；
 *        quote 透传展开行（含 bundle 标记）
 *   BD-4 组件库存不足 → 400 且整单不落；取消订单回补组件库存
 *   BD-5 组合包 + 满减叠加：组件行按分摊价参与满减，discount_allocated 合计 = 减免额
 *   BD-6 积分换购单带 bundle → 400
 *   BD-7 购物车：加组合包/列表带 bundle 快照/改数量/删除；product_id 与 bundle_id 同传 → 400
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

/** 直接落库组合包（BD-1 的 admin 创建走接口） */
async function createBundle (overrides = {}, items = []) {
  const { Bundle, BundleItem } = sequelize.models
  const bundle = await Bundle.create({
    name: '组合包X',
    price: 100,
    status: 'active',
    ...overrides
  })
  if (items.length > 0) {
    await BundleItem.bulkCreate(items.map(it => ({ bundle_id: bundle.id, ...it })))
  }
  return bundle
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

describe('P4.bundle — admin CRUD 与校验', () => {
  it('BD-1 创建/列表/更新/状态/删除；组件不存在、价格非法、重复组件 → 400', async () => {
    const admin = await adminToken()
    const pA = await activeProduct({ name: '组件A' })
    const pB = await activeProduct({ name: '组件B' })

    // 创建 → 201，含 items 与组件商品名
    const created = await request(app)
      .post('/api/admin/bundles')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: '早餐组合',
        name_th: 'ชุดอาหารเช้า',
        price: 100,
        items: [
          { product_id: pA.id, quantity: 1 },
          { product_id: pB.id, quantity: 2 }
        ]
      })
    expect(created.status).toBe(201)
    const bundleId = created.body.data.id
    expect(created.body.data.items.length).toBe(2)
    expect(created.body.data.items.map(it => it.product?.name).sort()).toEqual(['组件A', '组件B'])

    // 组件不存在 → 400
    const missing = await request(app)
      .post('/api/admin/bundles')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '坏包', price: 100, items: [{ product_id: 999999, quantity: 1 }] })
    expect(missing.status).toBe(400)
    expect(missing.body.message).toMatch(/不存在/)

    // 价格非法（0 / 负数 / NaN）→ 400
    for (const badPrice of [0, -5, 'abc']) {
      const bad = await request(app)
        .post('/api/admin/bundles')
        .set('Authorization', `Bearer ${admin}`)
        .send({ name: '坏包', price: badPrice, items: [{ product_id: pA.id, quantity: 1 }] })
      expect(bad.status).toBe(400)
    }

    // 重复组件 → 400
    const dup = await request(app)
      .post('/api/admin/bundles')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: '重复包',
        price: 100,
        items: [
          { product_id: pA.id, quantity: 1 },
          { product_id: pA.id, quantity: 2 }
        ]
      })
    expect(dup.status).toBe(400)
    expect(dup.body.message).toMatch(/不可重复/)

    // items 为空 → 400；缺 name → 400
    const emptyItems = await request(app)
      .post('/api/admin/bundles')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '空包', price: 100, items: [] })
    expect(emptyItems.status).toBe(400)
    const noName = await request(app)
      .post('/api/admin/bundles')
      .set('Authorization', `Bearer ${admin}`)
      .send({ price: 100, items: [{ product_id: pA.id, quantity: 1 }] })
    expect(noName.status).toBe(400)

    // 列表：分页 + 状态筛选
    const list = await request(app)
      .get('/api/admin/bundles?status=active')
      .set('Authorization', `Bearer ${admin}`)
    expect(list.status).toBe(200)
    expect(list.body.data.total).toBe(1)
    expect(list.body.data.list[0].name).toBe('早餐组合')
    expect(list.body.data.list[0].items.length).toBe(2)

    // 更新（全量替换）：改价 + 组件换成单件
    const updated = await request(app)
      .put(`/api/admin/bundles/${bundleId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '早餐组合Pro', price: 200, items: [{ product_id: pA.id, quantity: 3 }] })
    expect(updated.status).toBe(200)
    expect(Number(updated.body.data.price)).toBe(200)
    expect(updated.body.data.items.length).toBe(1)
    expect(updated.body.data.items[0].quantity).toBe(3)

    // 更新时组件不存在 → 400
    const badUpdate = await request(app)
      .put(`/api/admin/bundles/${bundleId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '早餐组合Pro', price: 200, items: [{ product_id: 999999, quantity: 1 }] })
    expect(badUpdate.status).toBe(400)

    // 状态切换 → 200；非法状态 → 400
    const st = await request(app)
      .put(`/api/admin/bundles/${bundleId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'inactive' })
    expect(st.status).toBe(200)
    expect(st.body.data.status).toBe('inactive')
    const badSt = await request(app)
      .put(`/api/admin/bundles/${bundleId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'weird' })
    expect(badSt.status).toBe(400)

    // 删除 → 200；再查 → 404；组件行随包删除
    const del = await request(app)
      .delete(`/api/admin/bundles/${bundleId}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(del.status).toBe(200)
    const { BundleItem } = sequelize.models
    expect(await BundleItem.count({ where: { bundle_id: bundleId } })).toBe(0)
    const delAgain = await request(app)
      .delete(`/api/admin/bundles/${bundleId}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(delAgain.status).toBe(404)
  })
})

describe('P4.bundle — 公开接口', () => {
  it('BD-2 列表/详情含 standalone_total 与 available_stock；400/404 处理', async () => {
    // pC 直降 10% → 90；pD 无直降 200
    const pC = await activeProduct({ name: '组件C', price: 100, discount: 10, stock: 50 })
    const pD = await activeProduct({ name: '组件D', price: 200, stock: 20 })
    const bundle = await createBundle({ name: '组合包Y', price: 300 }, [
      { product_id: pC.id, quantity: 2 },
      { product_id: pD.id, quantity: 1 }
    ])
    await createBundle({ name: '停用包', status: 'inactive' }, [
      { product_id: pC.id, quantity: 1 }
    ])

    // 列表：只含 active；standalone_total = 90×2 + 200 = 380；available_stock = min(50/2, 20/1) = 20
    const list = await request(app).get('/api/bundles')
    expect(list.status).toBe(200)
    expect(list.body.data.length).toBe(1)
    const row = list.body.data[0]
    expect(row.id).toBe(bundle.id)
    expect(row.standalone_total).toBe(380)
    expect(row.available_stock).toBe(20)
    expect(row.items.length).toBe(2)
    const itemC = row.items.find(it => it.product_id === pC.id)
    expect(itemC.product_name).toBe('组件C')
    expect(itemC.unit_price).toBe(90)
    expect(itemC.quantity).toBe(2)

    // 详情口径同列表
    const detail = await request(app).get(`/api/bundles/${bundle.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.standalone_total).toBe(380)
    expect(detail.body.data.available_stock).toBe(20)

    // 非法 id → 400；不存在 → 404；已停用 → 404
    const bad = await request(app).get('/api/bundles/abc')
    expect(bad.status).toBe(400)
    const notFound = await request(app).get('/api/bundles/999999')
    expect(notFound.status).toBe(404)
    const { Bundle } = sequelize.models
    const inactive = await Bundle.findOne({ where: { name: '停用包' } })
    const inactRes = await request(app).get(`/api/bundles/${inactive.id}`)
    expect(inactRes.status).toBe(404)
  })
})

describe('P4.bundle — 下单与计价', () => {
  it('BD-3 下单组合包：OrderItem 展开为组件行（带 bundle_id）、总价 = 组合价、组件库存分别扣；quote 透传展开行', async () => {
    const { token } = await userWithToken()
    const pA = await activeProduct({ name: '组件A', price: 100, stock: 50 })
    const pB = await activeProduct({ name: '组件B', price: 50, stock: 50 })
    const bundle = await createBundle({ name: '组合包X', price: 100 }, [
      { product_id: pA.id, quantity: 1 },
      { product_id: pB.id, quantity: 1 }
    ])

    // quote：展开行透传 bundle 标记；权重 100:50 → 分摊 66.67 / 33.33
    const quote = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ bundle_id: bundle.id, quantity: 2 }], payment_method: 'cod' })
    expect(quote.status).toBe(200)
    expect(quote.body.data.items_total).toBe(200)
    expect(quote.body.data.payable_thb).toBe(200)
    expect(quote.body.data.lines.length).toBe(2)
    const quoteLineA = quote.body.data.lines.find(l => l.product_id === pA.id)
    expect(quoteLineA.bundle_id).toBe(bundle.id)
    expect(quoteLineA.bundle_name).toBe('组合包X')
    expect(quoteLineA.quantity).toBe(2)
    expect(quoteLineA.line_total).toBe(133.33)
    const quoteLineB = quote.body.data.lines.find(l => l.product_id === pB.id)
    expect(quoteLineB.line_total).toBe(66.67)

    // 下单 2 套：总价 = 100 × 2 = 200
    const res = await createCodOrder(token, [{ bundle_id: bundle.id, quantity: 2 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.total_amount_thb)).toBe(200)
    expect(Number(order.discount_amount)).toBe(0)

    // OrderItem 展开为组件行（带 bundle_id），分摊价落库
    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id }, order: [['id', 'ASC']] })
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.bundle_id === bundle.id)).toBe(true)
    const rowA = rows.find(r => r.product_id === pA.id)
    const rowB = rows.find(r => r.product_id === pB.id)
    expect(rowA.quantity).toBe(2)
    expect(Number(rowA.price)).toBe(66.67)
    expect(rowB.quantity).toBe(2)
    expect(Number(rowB.price)).toBe(33.34)

    // 组件库存分别扣：50 - 2 = 48
    expect(await currentStock(pA.id)).toBe(48)
    expect(await currentStock(pB.id)).toBe(48)
  })

  it('BD-4 组件库存不足 → 400 且库存不动；取消订单回补组件库存', async () => {
    const { token } = await userWithToken()
    const admin = await adminToken()
    const pA = await activeProduct({ name: '组件A', price: 100, stock: 50 })
    const pB = await activeProduct({ name: '组件B', price: 50, stock: 1 })
    const bundle = await createBundle({ name: '组合包X', price: 100 }, [
      { product_id: pA.id, quantity: 1 },
      { product_id: pB.id, quantity: 1 }
    ])

    // 买 2 套：pB 需 2 件但只有 1 件 → 400，两个组件库存都不动
    const lack = await createCodOrder(token, [{ bundle_id: bundle.id, quantity: 2 }])
    expect(lack.status).toBe(400)
    expect(lack.body.message).toMatch(/库存不足/)
    expect(await currentStock(pA.id)).toBe(50)
    expect(await currentStock(pB.id)).toBe(1)

    // 买 1 套成功；admin 取消后组件库存回补
    const ok = await createCodOrder(token, [{ bundle_id: bundle.id, quantity: 1 }])
    expect(ok.status).toBe(201)
    expect(await currentStock(pA.id)).toBe(49)
    expect(await currentStock(pB.id)).toBe(0)

    const cancel = await request(app)
      .put(`/api/admin/orders/${ok.body.data.order.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'cancelled' })
    expect(cancel.status).toBe(200)
    expect(await currentStock(pA.id)).toBe(50)
    expect(await currentStock(pB.id)).toBe(1)
  })

  it('BD-5 组合包 + 满减叠加：组件行按分摊价参与满减', async () => {
    const { token } = await userWithToken()
    const pA = await activeProduct({ name: '组件A', price: 100, stock: 50 })
    const pB = await activeProduct({ name: '组件B', price: 50, stock: 50 })
    const bundle = await createBundle({ name: '组合包X', price: 100 }, [
      { product_id: pA.id, quantity: 1 },
      { product_id: pB.id, quantity: 1 }
    ])
    const { Promotion, OrderPromotion } = sequelize.models
    await Promotion.create({
      type: 'threshold',
      name: '满100减10',
      rules: { tiers: [{ min: 100, off: 10 }] },
      scope: { type: 'all', ids: [] },
      priority: 0,
      status: 'active'
    })

    // 组合价 100 命中满 100 减 10 → 应付 90；分摊价 66.67/33.33 参与满减
    const res = await createCodOrder(token, [{ bundle_id: bundle.id, quantity: 1 }])
    expect(res.status).toBe(201)
    const order = res.body.data.order
    expect(Number(order.total_amount_thb)).toBe(90)
    expect(Number(order.discount_amount)).toBe(10)

    // 订单促销快照一行（满 100 减 10）
    const promoRows = await OrderPromotion.findAll({ where: { order_id: order.id } })
    expect(promoRows.length).toBe(1)
    expect(promoRows[0].name).toBe('满100减10')
    expect(Number(promoRows[0].amount)).toBe(10)

    // 行分摊合计 = 10（66.67/100 → 6.67；33.33/100 → 3.33）
    const { OrderItem } = sequelize.models
    const rows = await OrderItem.findAll({ where: { order_id: order.id } })
    const allocatedSum = rows.reduce((s, r) => s + Number(r.discount_allocated), 0)
    expect(Math.round(allocatedSum * 100) / 100).toBe(10)
  })

  it('BD-6 积分换购单带 bundle → 400', async () => {
    const { token } = await userWithToken()
    const pA = await activeProduct({ name: '组件A', price: 100, stock: 50, points: 10 })
    const bundle = await createBundle({ name: '组合包X', price: 100 }, [
      { product_id: pA.id, quantity: 1 }
    ])

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...ORDER_BODY, items: [{ bundle_id: bundle.id, quantity: 1 }], payment_method: 'points' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/组合包/)

    // quote 侧同样拦截
    const quote = await request(app)
      .post('/api/orders/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ bundle_id: bundle.id, quantity: 1 }], payment_method: 'points' })
    expect(quote.status).toBe(400)
    expect(quote.body.message).toMatch(/组合包/)
  })
})

describe('P4.bundle — 购物车', () => {
  it('BD-7 加组合包/列表带 bundle 快照/改数量/删除；二选一校验', async () => {
    const { user, token } = await userWithToken()
    const pA = await activeProduct({ name: '组件A', price: 100, stock: 50 })
    const pB = await activeProduct({ name: '组件B', price: 50, stock: 50 })
    const bundle = await createBundle({ name: '组合包X', price: 100 }, [
      { product_id: pA.id, quantity: 1 },
      { product_id: pB.id, quantity: 1 }
    ])

    // product_id 与 bundle_id 同传 → 400；都不传 → 400；数量 100 → 400
    const both = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: pA.id, bundle_id: bundle.id, quantity: 1 })
    expect(both.status).toBe(400)
    const neither = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 })
    expect(neither.status).toBe(400)
    const tooMany = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ bundle_id: bundle.id, quantity: 100 })
    expect(tooMany.status).toBe(400)

    // 加组合包 → 200；price 存组合价；product_id 为 NULL
    const add = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ bundle_id: bundle.id, quantity: 1 })
    expect(add.status).toBe(200)
    expect(add.body.data.bundle_id).toBe(bundle.id)
    expect(add.body.data.product_id).toBeNull()
    expect(Number(add.body.data.price)).toBe(100)
    const cartId = add.body.data.id

    // 列表：bundle 行带快照（名称/组件摘要）
    const cart = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${token}`)
    expect(cart.status).toBe(200)
    expect(cart.body.data.length).toBe(1)
    const cartRow = cart.body.data[0]
    expect(cartRow.product).toBeNull()
    expect(cartRow.bundle).toBeTruthy()
    expect(cartRow.bundle.name).toBe('组合包X')
    expect(cartRow.bundle.items.length).toBe(2)
    expect(cartRow.bundle.items.map(it => it.product?.name).sort()).toEqual(['组件A', '组件B'])

    // 重复加同一 bundle → 数量累加
    const addMore = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ bundle_id: bundle.id, quantity: 2 })
    expect(addMore.status).toBe(200)
    expect(addMore.body.data.quantity).toBe(3)
    const { Cart } = sequelize.models
    expect(await Cart.count({ where: { user_id: user.id, bundle_id: bundle.id } })).toBe(1)

    // 改数量 → 200
    const upd = await request(app)
      .put(`/api/cart/${cartId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
    expect(upd.status).toBe(200)
    expect(Number(upd.body.data.quantity)).toBe(5)

    // 组件库存不足的数量 → 400（pB 50 件，配比 1，改 51 套超库存）
    const updLack = await request(app)
      .put(`/api/cart/${cartId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 51 })
    expect(updLack.status).toBe(400)

    // 删除 → 200，购物车清空
    const del = await request(app)
      .delete(`/api/cart/${cartId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)
    expect(await Cart.count({ where: { user_id: user.id } })).toBe(0)
  })
})
