/**
 * 删单后的**引用完整性**：抵扣券不能变成悬空引用
 *
 * ## 背景
 *
 * `user_coupons.used_by_order_id` **没有外键**（全表只有 user_id / template_id 有 FK），
 * 而 Order 是**硬删**（无 paranoid）。
 *
 * 管理端删单时：
 *   - pending/paid/shipping → 走 restoreOrderResources → 券退回 unused ✅
 *   - shipped/delivered/completed/cancelled → **不**回补资源
 *     （这是对的：货已发出，库存/积分不能虚增）
 *
 * 但**券不在"资源"这一类里** —— 它被核销在了一个已经不存在的订单上，
 * 于是留下 `status='used' AND used_by_order_id=<不存在的订单>`：
 *   - 用户在"我的优惠券"里看到它永远是"已使用"，再也用不了；
 *   - 而体检项 `coupon_used_has_order` 只查 `used_by_order_id IS NULL`，
 *     **查不出这种"挂着一个不存在的订单"的情况** —— 名字叫 has_order，
 *     实际没验证 order 是否存在。
 *
 * ## 用例
 *   DC-1 删掉已履约订单 → 券不得指向已不存在的订单（不能悬空）
 *   DC-2 删掉未履约订单 → 券退回未使用（已有行为的护栏）
 *   DC-3 体检项必须能抓到"券挂着不存在的订单"
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { CHECKS } from '@server/utils/dataInvariants.js'

const models = () => TestDatabase.getSequelize().models

let user
let adminToken
let template

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900001111'
  }))
  template = await models().CouponTemplate.create({
    name: `删单券_${Date.now()}`,
    type: 'discount',
    amount: 50,
    min_spend: 100,
    status: 'active',
    scope: { type: 'all', ids: [] }
  })
})

/** 建一张已用券的订单 */
async function mkOrderWithUsedCoupon (status) {
  const { Order, OrderItem, Product, UserCoupon } = models()
  const product = await Product.create({ name: '删单商品', price: 100, stock: 50, status: 'active' })
  const order = await Order.create({
    order_no: `del_coupon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    contact_name: '测试',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1
  })
  await OrderItem.create({
    order_id: order.id, product_id: product.id, quantity: 1,
    price: 100, original_price: 100, product_name_zh: product.name
  })
  const coupon = await UserCoupon.create({
    template_id: template.id,
    user_id: user.id,
    code: `DC${Date.now().toString(36)}`,   // varchar(24) 上限内
    status: 'used',
    used_by_order_id: order.id,
    used_at: new Date()
  })
  return { order, coupon, product }
}

describe('删单后的券引用完整性', () => {
  it('DC-1 删掉已履约订单 → 券不得指向已不存在的订单', async () => {
    const { order, coupon } = await mkOrderWithUsedCoupon('completed')

    const res = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const { Order, UserCoupon } = models()
    expect(await Order.findByPk(order.id), '订单应已删除').toBeFalsy()

    const after = await UserCoupon.findByPk(coupon.id)
    expect(after, '券本身不应被删（用户仍持有）').toBeTruthy()

    // 关键：券不能挂在一个已经不存在的订单上
    if (after.used_by_order_id != null) {
      const stillThere = await Order.findByPk(after.used_by_order_id)
      expect(
        stillThere,
        `券仍指向已删除的订单 ${after.used_by_order_id} —— 悬空引用，用户再也用不了这张券`
      ).toBeTruthy()
    }
    // 若券被退回未使用，也不该再挂着订单
    if (after.status === 'unused') {
      expect(after.used_by_order_id).toBeNull()
    }
  })

  it('DC-2 删掉未履约订单 → 券退回未使用（护栏：既有正确行为别退化）', async () => {
    const { order, coupon } = await mkOrderWithUsedCoupon('pending')

    const res = await request(app).delete(`/api/admin/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const after = await models().UserCoupon.findByPk(coupon.id)
    expect(after.status, '未履约订单删除后券应退回未使用').toBe('unused')
    expect(after.used_by_order_id).toBeNull()
  })

  it('DC-3 体检项必须能抓到「券挂着不存在的订单」', async () => {
    const check = CHECKS.find(c => c.name === 'coupon_used_order_exists')
    expect(check, '缺少 coupon_used_order_exists 检查项').toBeTruthy()

    // 直接造一条悬空数据（绕开应用层），体检必须抓到
    const { UserCoupon } = models()
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: `DANG${Date.now().toString(36)}`,
      status: 'used',
      used_by_order_id: 987654321   // 不存在的订单
    })

    const { QueryTypes } = await import('sequelize')
    const rows = await TestDatabase.getSequelize().query(check.sql, {
      type: QueryTypes.SELECT,
      replacements: { days: '30' }
    })
    expect(
      rows.length,
      '体检项查不出「券挂着不存在的订单」—— 检查名不副实（只查 IS NULL，没查订单是否存在）'
    ).toBeGreaterThan(0)
  })

  it('DC-4 体检项查不出悬空券时，必须报红而不是静默放过', async () => {
    // 上一条 DC-3 证明检查能抓到；这里再证明"没有悬空数据时它不报"，
    // 避免新检查变成另一种"永远绿"（SQL 写错恒真）。
    const check = CHECKS.find(c => c.name === 'coupon_used_order_exists')
    const { QueryTypes } = await import('sequelize')
    const rows = await TestDatabase.getSequelize().query(check.sql, {
      type: QueryTypes.SELECT,
      replacements: { days: '30' }
    })
    expect(rows.length, '没有悬空券时不该报错').toBe(0)
  })
})
