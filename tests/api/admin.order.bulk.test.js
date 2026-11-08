/**
 * 批量改订单状态（POST /api/admin/orders/bulk/status）
 *
 * 运营的真实动作是成批的：今天这几单一起发、这批单全部完成。
 * 之前只能一单一单点开详情改 —— 点十几次，而且漏掉的那单往往就是客户催得最急的那单。
 *
 * 这条链路最容易出错的地方不是"能不能改"，而是：
 *   1) 批量取消**必须回补库存/积分**（单条路径是回补的，批量漏了就白送库存）
 *   2) 不合法的状态流转要**跳过并回报**，不能硬改
 *   3) 整批要么全改要么全不改（不能改一半）
 *
 *   AB-1 批量改状态 → 全部可改的单都改了
 *   AB-2 不合法的流转 → 跳过 + 回报原因
 *   AB-3 空的 ids → 400
 *   AB-4 非法 status → 400
 *   AB-5 无 token → 401
 *   AB-6 超过 200 个 → 400
 *   AB-7 批量取消 → 回补库存（不能白送）
 *   AB-8 不存在的 id → 出现在 skipped 里（不静默吞掉）
 *   AB-9 批量带物流单号 → 所有改动的单都带上
 *   AB-10 无 orders 权限的角色 → 403
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

/**
 * 建一张带商品的订单。
 * @param {string} status 订单初始状态
 * @param {object} opts { stock, quantity, userId }
 */
async function makeOrder (status = 'shipping', opts = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User, Product, Order, OrderItem } = sequelize.models

  let user = null
  if (opts.userId) {
    user = await User.findByPk(opts.userId)
  }
  if (!user) {
    user = await User.create(await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    }))
  }

  const product = await Product.create(TestDataFactory.createProduct({
    stock: opts.stock ?? 10,
    price: 50
  }))
  const quantity = opts.quantity ?? 2
  const order = await Order.create({
    order_no: `OB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    user_id: user.id,
    total_amount: 50 * quantity,
    total_amount_thb: 50 * quantity,
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    contact_name: 'X',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity,
    price: 50,
    original_price: 50,
    product_name_zh: product.name
  })
  return { user, product, order }
}

const bulk = (token, body) =>
  request(app).post('/api/admin/orders/bulk/status').set('Authorization', `Bearer ${token}`).send(body)

describe('P3.admin.order.bulk — 批量改订单状态', () => {
  it('AB-1 批量改状态：可改的单全改，不改的不动', async () => {
    const { token } = await adminCtx()
    const a = await makeOrder('shipping')
    const b = await makeOrder('shipping')
    const c = await makeOrder('completed') // 终态，不可再变

    const res = await bulk(token, { ids: [a.order.id, b.order.id, c.order.id], status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.changed.sort()).toEqual([a.order.id, b.order.id].sort())
    expect(res.body.data.skipped.map(s => s.id)).toContain(c.order.id)

    const sequelize = TestDatabase.getSequelize()
    const { Order } = sequelize.models
    expect((await Order.findByPk(a.order.id)).status).toBe('shipped')
    expect((await Order.findByPk(b.order.id)).status).toBe('shipped')
    expect((await Order.findByPk(c.order.id)).status).toBe('completed')
  })

  it('AB-2 不合法的流转 → 跳过 + 回报原因', async () => {
    const { token } = await adminCtx()
    const { order } = await makeOrder('pending') // pending 不能直接到 shipped
    const res = await bulk(token, { ids: [order.id], status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.data.changed).toHaveLength(0)
    expect(res.body.data.skipped).toHaveLength(1)
    expect(res.body.data.skipped[0].reason).toMatch(/不允许/)
  })

  it('AB-3 空的 ids → 400', async () => {
    const { token } = await adminCtx()
    const res = await bulk(token, { ids: [], status: 'shipped' })
    expect(res.status).toBe(400)
  })

  it('AB-4 非法 status → 400', async () => {
    const { token } = await adminCtx()
    const { order } = await makeOrder('shipping')
    const res = await bulk(token, { ids: [order.id], status: 'not_a_status' })
    expect(res.status).toBe(400)
  })

  it('AB-5 无 token → 401', async () => {
    const { order } = await makeOrder('shipping')
    const res = await request(app)
      .post('/api/admin/orders/bulk/status')
      .send({ ids: [order.id], status: 'shipped' })
    expect(res.status).toBe(401)
  })

  it('AB-6 超过 200 个 id → 400', async () => {
    const { token } = await adminCtx()
    const ids = Array.from({ length: 201 }, (_, i) => i + 1)
    const res = await bulk(token, { ids, status: 'shipped' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/200/)
  })

  it('AB-7 批量取消 → 回补库存（不能白送库存）', async () => {
    const { token } = await adminCtx()
    const { product, order } = await makeOrder('shipping', { stock: 10, quantity: 3 })
    expect(product.stock).toBe(10)

    const res = await bulk(token, { ids: [order.id], status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(res.body.data.changed).toEqual([order.id])

    const sequelize = TestDatabase.getSequelize()
    const { Product, Order } = sequelize.models
    expect((await Product.findByPk(product.id)).stock).toBe(13) // 10 + 3 回补
    expect((await Order.findByPk(order.id)).status).toBe('cancelled')
  })

  it('AB-8 不存在的 id → 出现在 skipped 里（不静默吞掉）', async () => {
    const { token } = await adminCtx()
    const { order } = await makeOrder('shipping')
    const res = await bulk(token, { ids: [order.id, 999999], status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.data.changed).toEqual([order.id])
    const missing = res.body.data.skipped.find(s => s.id === 999999)
    expect(missing).toBeTruthy()
    expect(missing.reason).toMatch(/不存在/)
  })

  it('AB-9 批量带物流单号 → 所有改动的单都带上', async () => {
    const { token } = await adminCtx()
    const a = await makeOrder('shipping')
    const b = await makeOrder('shipping')
    const res = await bulk(token, {
      ids: [a.order.id, b.order.id],
      status: 'shipped',
      tracking_number: 'SF123456',
      admin_note: '批量备注'
    })
    expect(res.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Order } = sequelize.models
    for (const o of [a.order, b.order]) {
      const fresh = await Order.findByPk(o.id)
      expect(fresh.tracking_number).toBe('SF123456')
      expect(fresh.admin_note).toBe('批量备注')
      expect(fresh.shipped_at).toBeTruthy()
    }
  })

  it('AB-10 管理员被停用 → 401 且订单不动', async () => {
    const { token, admin } = await adminCtx()
    const { order } = await makeOrder('shipping')
    // 停用管理员（后台被禁用 / 离职）→ token 立刻失效，不能再改单
    await admin.update({ is_active: false })

    const res = await bulk(token, { ids: [order.id], status: 'shipped' })
    expect([401, 403]).toContain(res.status)
    const sequelize = TestDatabase.getSequelize()
    const { Order } = sequelize.models
    expect((await Order.findByPk(order.id)).status).toBe('shipping')
  })

  it('AB-11 混合状态：能改的改、不能改的跳过，一批里互不影响', async () => {
    const { token } = await adminCtx()
    const a = await makeOrder('shipping')
    const b = await makeOrder('pending')
    const res = await bulk(token, { ids: [a.order.id, b.order.id], status: 'shipped' })
    expect(res.status).toBe(200)
    expect(res.body.data.changed).toEqual([a.order.id])
    expect(res.body.data.skipped.map(s => s.id)).toEqual([b.order.id])
  })

  it('AB-12 批量取消时积分已被用掉 → 跳过，不允许取消', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { UserPointBalance, PointTransaction } = sequelize.models

    const { user, order } = await makeOrder('shipping')
    // 模拟：该单已发放 100 购物积分，但用户已把积分花光
    await PointTransaction.create({
      user_id: user.id,
      order_id: order.id,
      type: 'earn_purchase',
      delta: 100,
      balance_after: 100,
      description: '测试发放'
    }).catch(() => {})
    await UserPointBalance.upsert({
      user_id: user.id,
      balance: 0,
      total_earned: 100,
      total_spent: 100
    })

    const res = await bulk(token, { ids: [order.id], status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(res.body.data.changed).toHaveLength(0)
    expect(res.body.data.skipped[0].reason).toMatch(/积分已被使用/)
  })
})
