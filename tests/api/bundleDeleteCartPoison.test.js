/**
 * 删除组合包不能给客户留"毒行"
 *
 * ## 背景
 *
 * 组合包是**硬删**（Bundle 无 paranoid），删除时只清了 `bundle_items`，
 * **没清购物车里的组合包行**（`carts.bundle_id`）。
 *
 * 而 `carts.bundle_id` 在生产库**没有外键**（测试库有、生产库没有 —— 见文档）。
 * 于是删完组合包，购物车里留下一行指向已删除组合包的记录：
 *
 *   1. 购物车列表 include bundle 是 required:false → 那行**没有名称**；
 *   2. 更要命：结算时 pricingEngine 遇到不存在的组合包会
 *      `throw businessError('组合包ID X 不存在')` ——
 *      **整个订单算不出来 → 客户再也结算不了**（一个管理员操作废掉一个客户的购物车）。
 *
 * ## 用例
 *   BD-1 删掉组合包 → 购物车里不能留下指向它的行
 *   BD-2 删掉组合包后 → 客户仍能正常结算（不被"毒行"卡死）
 *   BD-3 组合包删除不能误伤普通商品行
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'

const models = () => TestDatabase.getSequelize().models

let user
let token
let adminToken
let product

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900002222'
  }))
  token = TestHelpers.generateToken(user)
  product = await models().Product.create({
    name: '组合包组件', price: 100, stock: 100, status: 'active'
  })
})

/** 建一个组合包并把它加进购物车 */
async function mkBundleInCart () {
  const { Bundle, BundleItem, Cart } = models()
  const bundle = await Bundle.create({
    name: '待删组合包',
    price: 150,
    status: 'active',
    description: 'x',
    image: null
  })
  await BundleItem.create({
    bundle_id: bundle.id, product_id: product.id, quantity: 1, sort_order: 0
  })
  const res = await request(app).post('/api/cart')
    .set('Authorization', `Bearer ${token}`)
    .send({ bundle_id: bundle.id, quantity: 1 })
  expect(res.status).toBe(200)
  return { bundle }
}

describe('删除组合包不留毒行', () => {
  it('BD-1 删掉组合包 → 购物车里的那**整行**必须消失', async () => {
    const { bundle } = await mkBundleInCart()
    const { Cart } = models()
    expect(await Cart.count({ where: { bundle_id: bundle.id } }), '前置：购物车里应有组合包行').toBe(1)

    const del = await request(app).delete(`/api/admin/bundles/${bundle.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)

    // ⚠️ 只查 bundle_id 会**误判成"已清理"**：
    // 测试库的 FK 是 SET NULL，删组合包时它会把 bundle_id 置成 NULL ——
    // 那一行还在，只是不再指向任何组合包（product_id 与 bundle_id 双 NULL 的僵尸行）。
    // 生产库没有这个 FK，会直接留下指向幽灵组合包的引用。
    // 两个库的结局不同 → 断言必须落在"行本身没了"上。
    const left = await Cart.count({ where: { bundle_id: bundle.id } })
    expect(left, '购物车里留下了指向已删除组合包的行').toBe(0)

    const zombies = await Cart.count({
      where: { user_id: user.id, bundle_id: null, product_id: null }
    })
    expect(zombies, '留下了既没有商品也没有组合包的僵尸行（测试库 FK 置 NULL 的残留）').toBe(0)
  })

  it('BD-2 删掉组合包后 → 购物车里不留下"前端会当成失效商品"的残留行', async () => {
    const { bundle } = await mkBundleInCart()

    // 同时放一个普通商品行，确保不是"购物车空了"这种假通过
    const { Cart } = models()
    await Cart.create({
      user_id: user.id, product_id: product.id, quantity: 1, price: 100
    })

    const del = await request(app).delete(`/api/admin/bundles/${bundle.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)

    // 前端 Checkout 的 availableCartItems = items.filter(item => item.product || item.bundle)
    // → 既没 product 也没 bundle 的行会被判成"失效商品"并排除在下单之外，
    //   还会显示一条"失效商品"的提示行。留着它 = 客户看到一条没有名称的怪行。
    const rows = await Cart.findAll({ where: { user_id: user.id } })
    const broken = rows.filter(r => !r.product_id && !r.bundle_id)
    expect(broken.length, '留下了前端会判成失效商品的残留行').toBe(0)

    // 正常商品行必须还在，且能正常下单
    const order = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '测试',
        contact_phone: '13800138000',
        delivery_address: '测试地址',
        payment_method: 'cod'
      })
    expect([200, 201]).toContain(order.status)
  })

  it('BD-3 删除组合包不能误伤普通商品行', async () => {
    const { bundle } = await mkBundleInCart()
    const { Cart } = models()
    await Cart.create({
      user_id: user.id, product_id: product.id, quantity: 2, price: 100
    })

    const del = await request(app).delete(`/api/admin/bundles/${bundle.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)

    const normal = await Cart.count({ where: { user_id: user.id, product_id: product.id } })
    expect(normal, '普通商品行不该被组合包删除牵连').toBe(1)
  })
})
