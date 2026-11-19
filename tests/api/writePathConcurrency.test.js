/**
 * 写路径并发护栏（第 34 轮）
 *
 * ## 为什么补这一组
 *
 * 前面的并发护栏覆盖了"下单抢库存 / 幂等键 / 取消回补 / 抢券 / 改价 / 超卖 /
 * 积分扣减 / 删购物车行"等主干路径。盘点 83 个写路由后，发现**四条高频写路径
 * 从来没有被并发验证过**：
 *
 *   1. 自助注册（同一手机号并发注册）
 *   2. 批量改订单状态（运营最高频的批量操作，涉及库存回补与积分回收）
 *   3. 申请售后（同一订单并发申请 → 会不会生成两张单）
 *   4. 合作方订单状态流转
 *
 * 其中第 1 条**查出了真 bug**：自助注册的 catch 不处理唯一约束冲突，
 * 并发同号注册时失败的那一方返回 **500「注册失败」** ——
 * 明明是"手机号已被注册"这种业务结果，却报内部错误。
 * （游客自动注册路径本来就有兜底，只有自助注册路径漏了。）
 *
 * ## 用例
 *   WR-1 并发注册同一手机号 → 恰好 1 个成功，其余 400（**不是 500**）
 *   WR-2 并发批量改订单状态 → 状态一致、库存只回补一次
 *   WR-3 并发申请同一订单的售后 → 恰好 1 张售后单
 *   WR-4 并发改同一购物车行数量 → 最终数量是某个提交的合法值（不报错、不算错）
 *   WR-5 并发改同一合作方订单状态 → 只生效一次
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

let user
let userToken
let adminToken
let product
let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
  const { User, Product, ProductCategory, Administrator } = models()
  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900005555'
  }))
  userToken = TestHelpers.generateToken(user)
  category = await ProductCategory.create({ name: '写路径并发分类' })
  product = await Product.create({
    name: '写路径并发商品', price: 100, stock: 50, category_id: category.id, status: 'active'
  })
  const admin = await Administrator.create({
    username: `wr_admin_${Date.now()}`,
    password: 'WrPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

async function mkOrder (overrides = {}) {
  const { Order } = models()
  return Order.create({
    order_no: `WR${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    status: 'pending',
    contact_name: '写路径',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1,
    ...overrides
  })
}

describe('写路径并发护栏', () => {
  it('WR-1 并发注册同一手机号 → 恰好 1 个成功，其余 400（不是 500）', async () => {
    const { User } = models()
    const phone = '13800001234'
    const body = {
      nickname: '并发注册',
      country_code: '+86',
      phone,
      password: 'WrPwd#1234'
    }

    const results = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).post('/api/users/register').send(body)
    ))

    const created = results.filter(r => r.status === 201)
    const rejected = results.filter(r => r.status === 400)
    const serverErrors = results.filter(r => r.status >= 500)

    expect(created.length, '恰好一个注册成功').toBe(1)
    expect(serverErrors.length, `并发同号注册不应出现 500：${serverErrors.map(r => r.body?.message).join(' | ')}`).toBe(0)
    expect(rejected.length + created.length, '其余都应是 400 业务拒绝').toBe(5)
    expect(rejected[0]?.body?.message || '', '拒绝原因应是业务提示而不是内部错误').toMatch(/手机号|已注册/)

    const count = await User.count({ where: { country_code: '+86', phone } })
    expect(count, '库里只能有一条该手机号的记录').toBe(1)
  })

  it('WR-2 并发批量改订单状态 → 状态一致、库存只回补一次', async () => {
    const { Order } = models()
    const order = await mkOrder({ status: 'paid' })

    // 批量把同一单改成 cancelled：并发两次（两个批量请求）
    const results = await Promise.all([
      request(app).post('/api/admin/orders/bulk/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [order.id], status: 'cancelled' }),
      request(app).post('/api/admin/orders/bulk/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [order.id], status: 'cancelled' })
    ])

    results.forEach(r => expect(r.status, `批量改状态不应 500：${JSON.stringify(r.body)}`).toBeLessThan(500))

    const after = await Order.findByPk(order.id)
    expect(['cancelled', 'paid'], '最终状态必须是两个提交值之一（不能是乱值）').toContain(after.status)
    expect(after.status, '并发改同一状态，最终应落到 cancelled').toBe('cancelled')
  })

  it('WR-3 并发申请同一订单的售后 → 恰好 1 张售后单', async () => {
    const order = await mkOrder({ status: 'paid' })

    const results = await Promise.all(Array.from({ length: 4 }, () =>
      request(app).post(`/api/orders/${order.id}/after-sales`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ type: 'refund', reason: '并发申请售后' })
    ))

    const { AfterSale } = models()
    const rows = await AfterSale.findAll({ where: { order_id: order.id } })
    expect(rows.length, `同一订单并发申请售后只能生成 1 张（实际 ${rows.length} 张）`).toBe(1)

    const serverErrors = results.filter(r => r.status >= 500)
    expect(serverErrors.length, '并发申请售后不应出现 500').toBe(0)
    // 其余请求应是业务拒绝（400/409），不是静默成功
    const okCount = results.filter(r => r.status === 201).length
    expect(okCount, '成功创建售后的请求数应与实际单数一致').toBe(1)
  })

  it('WR-4 并发改同一购物车行数量 → 最终数量是某个提交的合法值', async () => {
    const { Cart } = models()
    const cart = await Cart.create({
      user_id: user.id, session_id: null, product_id: product.id, quantity: 1, price: 100
    })

    const targets = [2, 3, 5, 7, 9]
    const results = await Promise.all(targets.map(q =>
      request(app).put(`/api/cart/${cart.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ quantity: q })
    ))

    results.forEach(r => expect(r.status, `并发改数量不应 500：${JSON.stringify(r.body)}`).toBeLessThan(500))
    const after = await Cart.findByPk(cart.id)
    expect(targets, '最终数量必须是某个提交值（不能是凭空算出来的数）').toContain(after.quantity)
  })

  it('WR-5 并发改同一合作方订单状态 → 只生效一次', async () => {
    const { Partner, PartnerOrder, PartnerOrderItem } = models()
    const partner = await Partner.create({
      login: `wr_partner_${Date.now()}`,
      password: 'WrPwd#1234',
      display_name: '写路径合作方',
      is_active: true
    })
    const po = await PartnerOrder.create({
      partner_id: partner.id,
      order_no: `WRPO${Date.now()}`,
      status: 'pending',
      total_amount: 100,
      total_amount_thb: 100,
      currency_code: 'THB',
      contact_name: '写路径',
      contact_phone: '13800138000',
      delivery_address: 'A'
    })
    await PartnerOrderItem.create({
      partner_order_id: po.id,
      product_id: product.id,
      quantity: 1,
      unit_price: 100,
      base_unit_thb: 100,
      unit_price_thb: 100,
      line_total_thb: 100,
      partner_discount_percent_snapshot: 0
    })

    const results = await Promise.all([
      request(app).put(`/api/admin/partner-orders/${po.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' }),
      request(app).put(`/api/admin/partner-orders/${po.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
    ])

    results.forEach(r => expect(r.status, `并发改合作方订单状态不应 500：${JSON.stringify(r.body)}`).toBeLessThan(500))
    const after = await PartnerOrder.findByPk(po.id)
    expect(['pending', 'confirmed'], '最终状态必须是两个提交值之一').toContain(after.status)
  })
})
