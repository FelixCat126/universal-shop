/**
 * 支付对账台账护栏（第 51 轮）
 * ===========================
 *
 * ## 这个功能解决什么
 *
 * 超时未支付被清扫掉的订单，单据在 `payment_reconciliation_records`
 * 留了**完整快照**（单号/金额/商品明细/地址/备注/下单人/时间）。
 * 运营据此逐单核对"这笔钱到底收没收到"。
 *
 * ## 用例
 *
 *   RG-1 清扫后台账行存在，且**含商品明细快照**（本轮的核心价值）
 *   RG-2 **同事务**：对账记录写失败 → 订单**不被删**（快照写不进时绝不能"单子没了"）
 *   RG-3 零售与合作方两条清扫路径都写台账，字段口径一致
 *   RG-4 operator 调接口 → 403；admin / super_admin → 200
 *   RG-5 标记结论后状态持久化，且**不改动任何订单/库存**
 *   RG-6 导出内容含关键列（单号/应收/实收/凭证号/结论）
 *   RG-7 存量回填幂等（迁移跑两次不重复插入）
 *
 * ## RG-2 为什么最重要
 *
 * "钱可能收了、系统里没这单"是本服务最坏的失败模式。
 * 同事务写入把它变成：**宁可订单留着**（运营看到"有单没清掉"），
 * 也不能出现"单子消失、无处回捞"。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { sweepExpiredPendingOrders } from '@server/services/orderTimeoutService.js'
import PaymentReconciliationRecord from '@server/models/PaymentReconciliationRecord.js'

describe('支付对账台账护栏', () => {
  let sequelize

  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    await seedSystemConfigBaseline()
  })

  /** 走真实下单接口创建 online pending 单 */
  async function createRetailOrder ({ stock = 10, qty = 2 } = {}) {
    const { User, Product } = sequelize.models
    const user = await User.create(await TestDataFactory.createUser())
    const token = TestHelpers.generateToken(user)
    const product = await Product.create(
      TestDataFactory.createProduct({ stock, price: 100, status: 'active' })
    )
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: qty }],
        contact_name: '对账测试收货人',
        contact_phone: '13800000001',
        delivery_address: '曼谷 测试路 1 号',
        notes: '对账测试备注',
        payment_method: 'online'
      })
    expect(res.status).toBe(201)
    const orderId = res.body.data.order.id
    // 拨到超时区间（默认阈值 10 分钟）
    await sequelize.models.Order.update(
      { created_at: new Date(Date.now() - 15 * 60 * 1000) },
      { where: { id: orderId } }
    )
    return { orderId, product, user }
  }

  /** 建一个超时的合作方 pending_payment 单 */
  async function createPartnerOrder ({ stock = 20, qty = 3 } = {}) {
    const { PartnerOrder, PartnerOrderItem, Product, Partner } = sequelize.models
    const partner = await Partner.create(await TestDataFactory.createPartner())
    const product = await Product.create(
      TestDataFactory.createProduct({ stock, price: 100, status: 'active' })
    )
    const order = await PartnerOrder.create(
      // ⚠️ 工厂默认 total_amount_thb: 0 —— 真实订单不会这样（金额由下单时算出），
      // 这里显式给一个真实金额，否则"台账金额 > 0"断言测的是工厂默认值而不是功能
      await TestDataFactory.createPartnerOrder(partner.id, {
        status: 'pending_payment',
        total_amount_thb: 3000
      })
    )
    await PartnerOrderItem.create(
      await TestDataFactory.createPartnerOrderItem(order.id, product.id, { quantity: qty })
    )
    await product.update({ stock: product.stock - qty })
    await PartnerOrder.update(
      { created_at: new Date(Date.now() - 15 * 60 * 1000) },
      { where: { id: order.id } }
    )
    return { order, product, partner }
  }

  it('RG-1 清扫后台账行存在，且含商品明细快照', async () => {
    const { orderId } = await createRetailOrder()
    const processed = await sweepExpiredPendingOrders()
    expect(processed.orders).toBe(1)

    const record = await PaymentReconciliationRecord.findOne({ where: { order_id: orderId } })
    expect(record, '清扫后没有留下对账台账行 —— 运营无从对账').toBeTruthy()
    expect(record.order_type).toBe('retail')
    expect(record.reconcile_status).toBe('pending')
    expect(record.order_no).toBeTruthy()
    expect(Number(record.total_amount_thb)).toBeGreaterThan(0)

    // 核心价值：商品明细在（订单已删，货还在快照里）
    expect(Array.isArray(record.items_snapshot)).toBe(true)
    expect(record.items_snapshot.length).toBe(1)
    expect(record.items_snapshot[0].quantity).toBe(2)
    expect(record.items_snapshot[0].name).toBeTruthy()
    expect(record.items_snapshot[0].line_total).not.toBeNull()

    // 收货信息与备注也在（对账时要对"送到哪、买了什么"）
    expect(record.contact_name).toBe('对账测试收货人')
    expect(record.notes).toBe('对账测试备注')
    expect(record.user_label).toBeTruthy()
    expect(record.swept_at).toBeTruthy()
  }, 30000)

  it('RG-2 同事务：对账记录写失败 → 订单不被删', async () => {
    const { Order, OrderItem } = sequelize.models
    const { orderId, product } = await createRetailOrder({ stock: 10, qty: 2 })

    // 让对账台账写入失败：把表临时改名（写不进去 → 事务回滚）
    await sequelize.query('ALTER TABLE payment_reconciliation_records RENAME TO payment_reconciliation_records_tmp')
    let processed
    try {
      processed = await sweepExpiredPendingOrders()
    } finally {
      await sequelize.query('ALTER TABLE payment_reconciliation_records_tmp RENAME TO payment_reconciliation_records')
    }

    // 清扫"没处理成功"（异常被单条捕获）
    expect(processed.orders).toBe(0)

    // 关键：订单**还在** —— 绝不能出现"快照写不进 → 单子也没了"
    const order = await Order.findByPk(orderId)
    expect(order, '对账记录写失败时订单被删了 —— 这是最坏的失败模式').toBeTruthy()
    expect(await OrderItem.count({ where: { order_id: orderId } })).toBe(1)

    // 库存也没回补（事务整体回滚了）
    await product.reload()
    expect(product.stock).toBe(8)
  }, 30000)

  it('RG-2b 同事务的另一半：删单失败 → 台账也不留残留行', async () => {
    const { Order } = sequelize.models
    const { orderId } = await createRetailOrder({ stock: 10, qty: 2 })

    // 让删单这一步失败（模拟删单时的意外）
    const originalDestroy = Order.prototype.destroy
    // eslint-disable-next-line no-unused-vars
    const spy = vi.spyOn(Order.prototype, 'destroy').mockImplementation(async function () {
      throw new Error('模拟删单失败')
    })

    try {
      const processed = await sweepExpiredPendingOrders()
      expect(processed.orders, '删单失败时不该算作处理成功').toBe(0)
    } finally {
      spy.mockRestore()
    }

    // 关键：台账**也不能有残留行** —— 写了台账但单没删，会造成重复对账
    const record = await PaymentReconciliationRecord.findOne({ where: { order_id: orderId } })
    expect(record, '删单失败却留下了台账行 —— 台账与订单不同步').toBeNull()

    // 订单确实还在
    expect(await Order.findByPk(orderId)).toBeTruthy()
  }, 30000)

  it('RG-3 合作方路径也写台账，字段口径一致', async () => {
    const { order, partner } = await createPartnerOrder()
    const processed = await sweepExpiredPendingOrders()
    expect(processed.partnerOrders).toBe(1)

    const record = await PaymentReconciliationRecord.findOne({ where: { order_id: order.id } })
    expect(record, '合作方单清扫后没有对账台账行').toBeTruthy()
    expect(record.order_type).toBe('partner')
    expect(record.reconcile_status).toBe('pending')
    expect(record.partner_id).toBe(partner.id)
    expect(record.user_label).toBeTruthy()
    expect(Number(record.total_amount_thb)).toBeGreaterThan(0)
    expect(Array.isArray(record.items_snapshot)).toBe(true)
    expect(record.items_snapshot.length).toBe(1)
    expect(record.items_snapshot[0].quantity).toBe(3)
    expect(record.items_snapshot[0].line_total).not.toBeNull()
  }, 30000)

  it('RG-4 operator 调接口 → 403；admin / super_admin → 200', async () => {
    const operator = await TestHelpers.createAdminUser({ role: 'operator' })
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const superAdmin = await TestHelpers.createAdminUser({ role: 'super_admin' })

    const opRes = await request(app).get('/api/admin/reconciliation')
      .set('Authorization', `Bearer ${TestHelpers.generateAdminToken(operator)}`)
    expect(opRes.status, 'operator 不该能看对账台账（标记「已收款」是财务动作）').toBe(403)

    const adminRes = await request(app).get('/api/admin/reconciliation')
      .set('Authorization', `Bearer ${TestHelpers.generateAdminToken(admin)}`)
    expect(adminRes.status).toBe(200)

    const superRes = await request(app).get('/api/admin/reconciliation')
      .set('Authorization', `Bearer ${TestHelpers.generateAdminToken(superAdmin)}`)
    expect(superRes.status).toBe(200)

    // operator 连"标记结论"也不该能做
    const opPut = await request(app).put('/api/admin/reconciliation/1')
      .set('Authorization', `Bearer ${TestHelpers.generateAdminToken(operator)}`)
      .send({ reconcile_status: 'received' })
    expect(opPut.status).toBe(403)
  }, 30000)

  it('RG-5 标记结论后状态持久化，且不改动任何订单/库存', async () => {
    const { Order, Product } = sequelize.models
    const { orderId, product } = await createRetailOrder({ stock: 10, qty: 2 })
    await sweepExpiredPendingOrders()

    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const token = TestHelpers.generateAdminToken(admin)

    const before = await PaymentReconciliationRecord.findOne({ where: { order_id: orderId } })
    expect(before.reconcile_status).toBe('pending')

    const res = await request(app).put(`/api/admin/reconciliation/${before.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reconcile_status: 'received',
        received_amount: 123.45,
        bank_ref: 'BANK-20261122-001',
        note: '已与收款码流水核对一致'
      })
    expect(res.status).toBe(200)
    expect(res.body.data.reconcile_status).toBe('received')
    expect(Number(res.body.data.received_amount)).toBe(123.45)
    expect(res.body.data.bank_ref).toBe('BANK-20261122-001')
    expect(res.body.data.reconciled_by_label).toBe(admin.username)
    expect(res.body.data.reconciled_at).toBeTruthy()

    // 重新查库确认落库
    const after = await PaymentReconciliationRecord.findByPk(before.id)
    expect(after.reconcile_status).toBe('received')
    expect(Number(after.received_amount)).toBe(123.45)

    // 边界：标记结论**不碰**订单与库存（订单早已被删；库存维持回补后的值）
    expect(await Order.findByPk(orderId)).toBeNull()
    await product.reload()
    expect(product.stock).toBe(10)
  }, 30000)

  it('RG-6 导出内容含关键列（单号/应收/实收/凭证号/结论）', async () => {
    const { orderId } = await createRetailOrder()
    await sweepExpiredPendingOrders()
    const record = await PaymentReconciliationRecord.findOne({ where: { order_id: orderId } })

    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const res = await request(app).get('/api/admin/reconciliation/export?format=csv')
      .set('Authorization', `Bearer ${TestHelpers.generateAdminToken(admin)}`)

    expect(res.status).toBe(200)
    const csv = res.text
    expect(csv).toContain(record.order_no)
    // 表头含关键列
    expect(csv).toContain('订单号')
    expect(csv).toContain('应收金额')
    expect(csv).toContain('实收金额')
    expect(csv).toContain('凭证号')
    expect(csv).toContain('核对结论')
    // 状态译文（不是原始枚举值）
    expect(csv).toContain('待核对')
  }, 30000)

  it('RG-7 存量回填幂等：迁移跑两次不重复插入', async () => {
    const { AuditLog } = sequelize.models
    await AuditLog.create({
      actor_type: 'system',
      event: 'order.timeout.swept',
      resource: 'order',
      resource_id: '999',
      success: true,
      detail: {
        order_no: 'LEGACY-SWEPT-001',
        total_amount: 100,
        total_amount_thb: 100,
        currency_code: 'THB',
        user_id: '1',
        created_at: new Date().toISOString(),
        swept_at: new Date().toISOString(),
        reason: '超时未支付，订单被自动清理'
      }
    })

    const migration = (await import('@server/migrations/017_payment_reconciliation_records.js')).default
    await migration.up({}, sequelize)
    await migration.up({}, sequelize)

    const rows = await PaymentReconciliationRecord.findAll({ where: { order_no: 'LEGACY-SWEPT-001' } })
    expect(rows.length, '存量回填不幂等 —— 迁移跑两次就产生重复行').toBe(1)
    expect(rows[0].reconcile_status).toBe('pending')
    expect(Number(rows[0].total_amount_thb)).toBe(100)
  }, 30000)
})
