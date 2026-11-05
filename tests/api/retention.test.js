/**
 * 数据保留策略测试（retentionService.cleanupRetentionData）
 *
 * 这套清理每天在生产跑一次，会**批量删除**历史数据，
 * 边界写错就是「误删用户资产」或「该删的没删」：
 *   RT-1 超期的 audit_logs / operation_logs / point_transactions 被删，期内保留
 *   RT-2 user_coupons：used 超期删 / unused **绝不删**（用户资产）/ expired 超 30 天删
 *   RT-3 游客购物车超期删；用户自己的购物车保留
 *   RT-4 export_jobs 超 7 天被删（连磁盘文件一起）
 *   RT-5 分批删除：batchSize=1 时多行也能删完（不能只删一批就停）
 *   RT-6 测试环境不启动定时清理器
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { cleanupRetentionData, startRetentionCleanup, runDailyInvariantCheck } from '@server/services/retentionService.js'

/**
 * 回拨时间戳。
 *
 * Sequelize 自动维护 createdAt/updatedAt（属性名是 updatedAt，列名才是 updated_at），
 * 在 create() 里传 updated_at 不生效 —— 必须用原生 SQL 改列。
 */
async function backdate (table, patch, where = {}) {
  const sequelize = TestDatabase.getSequelize()
  const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ')
  const whereSql = Object.keys(where).length
    ? 'WHERE ' + Object.keys(where).map(k => `${k} = ?`).join(' AND ')
    : ''
  const replacements = [...Object.values(patch), ...Object.values(where)]
  await sequelize.query(`UPDATE ${table} SET ${sets} ${whereSql}`, { replacements })
}

const DAY = 86400000
const models = () => TestDatabase.getSequelize().models

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('数据保留策略 retention', () => {
  it('RT-1 超期的审计/操作日志/积分流水被删，期内的保留', async () => {
    const { AuditLog, OperationLog, PointTransaction, User } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })

    const old = new Date(Date.now() - 800 * DAY)
    const fresh = new Date(Date.now() - 10 * DAY)

    // audit_logs：actor_type / event / success / created_at 必填
    await AuditLog.create({ actor_type: 'admin', event: 'old.event', success: true, created_at: old })
    await AuditLog.create({ actor_type: 'admin', event: 'fresh.event', success: true, created_at: fresh })

    await OperationLog.create({
      admin_id: admin.id,
      admin_username: admin.username,
      action: 'old.action',
      resource: 'order',
      description: '旧操作',
      created_at: old
    })
    await OperationLog.create({
      admin_id: admin.id,
      admin_username: admin.username,
      action: 'fresh.action',
      resource: 'order',
      description: '新操作',
      created_at: fresh
    })

    await PointTransaction.create({ user_id: user.id, type: 'earn_purchase', delta: 10, balance_after: 10, created_at: old })
    await PointTransaction.create({ user_id: user.id, type: 'earn_purchase', delta: 5, balance_after: 15, created_at: fresh })

    const result = await cleanupRetentionData()

    expect(result.auditDeleted).toBe(1)
    expect(result.operationDeleted).toBe(1)
    expect(result.pointDeleted).toBe(1)

    // 只剩「期内」那批
    const auditEvents = await AuditLog.findAll({ attributes: ['event'] })
    expect(auditEvents.map(r => r.event)).toEqual(['fresh.event'])
    const opActions = await OperationLog.findAll({ attributes: ['action'] })
    expect(opActions.map(r => r.action)).toEqual(['fresh.action'])
    const points = await PointTransaction.findAll({ attributes: ['delta'] })
    expect(points.map(r => Number(r.delta))).toEqual([5])
  }, 30000)

  it('RT-2 user_coupons：used 超期删 / unused 绝不删 / expired 超 30 天删', async () => {
    const { UserCoupon, CouponTemplate, User } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const template = await CouponTemplate.create({
      name: '保留策略券',
      amount: 20,
      min_spend: 100,
      total: null,
      per_user: 5,
      scope: { type: 'all', ids: [] },
      status: 'active'
    })

    // used + updated_at 很久以前 → 该删
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'RTUSEDOLD',
      status: 'used'
    })
    await backdate('user_coupons', { updated_at: new Date(Date.now() - 400 * DAY) }, { code: 'RTUSEDOLD' })
    // used + 最近才用过 → 保留
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'RTUSEDNEW',
      status: 'used'
    })
    await backdate('user_coupons', { updated_at: new Date(Date.now() - 5 * DAY) }, { code: 'RTUSEDNEW' })
    // expired + 过期很久 → 该删
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'RTEXPIREDOLD',
      status: 'expired',
      expire_at: new Date(Date.now() - 90 * DAY)
    })
    // expired + 刚过期 → 保留（给用户 30 天查看窗口）
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'RTEXPIREDFRESH',
      status: 'expired',
      expire_at: new Date(Date.now() - 3 * DAY)
    })
    // **未使用的券是用户资产，无论多老都不删**
    await UserCoupon.create({
      template_id: template.id,
      user_id: user.id,
      code: 'RTUNUSED',
      status: 'unused',
      created_at: new Date(Date.now() - 900 * DAY)
    })

    const result = await cleanupRetentionData()

    expect(result.couponDeleted).toBe(2)

    const remaining = await UserCoupon.findAll({ attributes: ['code'] })
    const codes = remaining.map(r => r.code).sort()
    expect(codes).toEqual(['RTEXPIREDFRESH', 'RTUNUSED', 'RTUSEDNEW'])
  }, 30000)

  it('RT-3 游客购物车超期删；用户自己的购物车保留', async () => {
    const { Cart, User, Product } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 10 }))

    await Cart.create({
      user_id: null,
      session_id: 'guest-old',
      product_id: product.id,
      quantity: 1,
      price: 10
    })
    await backdate('carts', { updated_at: new Date(Date.now() - 40 * DAY) }, { session_id: 'guest-old' })
    await Cart.create({
      user_id: null,
      session_id: 'guest-fresh',
      product_id: product.id,
      quantity: 1,
      price: 10
    })
    await backdate('carts', { updated_at: new Date(Date.now() - 2 * DAY) }, { session_id: 'guest-fresh' })
    await Cart.create({
      user_id: user.id,
      session_id: null,
      product_id: product.id,
      quantity: 1,
      price: 10
    })
    await backdate('carts', { updated_at: new Date(Date.now() - 400 * DAY) }, { user_id: user.id })

    const result = await cleanupRetentionData()

    expect(result.guestCartDeleted).toBe(1)
    const sessions = await Cart.findAll({ attributes: ['session_id', 'user_id'] })
    expect(sessions.length).toBe(2)
    expect(sessions.some(c => c.session_id === 'guest-old')).toBe(false)
    // 用户购物车必须还在
    expect(sessions.some(c => c.user_id === user.id)).toBe(true)
  }, 30000)

  it('RT-4 export_jobs 超 7 天被删（连磁盘文件一起）', async () => {
    const fs = await import('fs')
    const { ExportJob } = models()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })

    const old = await ExportJob.create({
      admin_id: admin.id,
      admin_username: admin.username,
      type: 'users',
      status: 'done',
      params: {}
    })
    const filePath = `/tmp/rt-export-${Date.now()}.xlsx`
    fs.writeFileSync(filePath, 'x')
    await old.update({ file_path: filePath, file_name: 'x.xlsx' })
    await ExportJob.update(
      { created_at: new Date(Date.now() - 10 * DAY) },
      { where: { id: old.id } }
    )

    const result = await cleanupRetentionData()

    expect(result.exportJobDeleted).toBe(1)
    expect(await ExportJob.findByPk(old.id)).toBeNull()
    expect(fs.existsSync(filePath)).toBe(false)
  }, 30000)

  it('RT-5 分批删除：batchSize=1 时多行也能删完', async () => {
    const { AuditLog } = models()
    const old = new Date(Date.now() - 800 * DAY)
    for (let i = 0; i < 5; i++) {
      await AuditLog.create({ actor_type: 'admin', event: `bulk.${i}`, success: true, created_at: old })
    }

    // batchSize=1：每批只删 1 行，但必须循环删完（不能一轮就停）
    const result = await cleanupRetentionData({ batchSize: 1 })
    expect(result.auditDeleted).toBe(5)
    expect(await AuditLog.count()).toBe(0)
  }, 30000)

  it('RT-6 测试环境不启动定时清理器', () => {
    expect(startRetentionCleanup()).toBeNull()
  })

  it('RT-7 每日数据体检：干净库通过，发现问题时报出来且不抛错', async () => {
    // 干净库 → 通过
    const ok = await runDailyInvariantCheck()
    expect(ok.ok).toBe(true)
    expect(ok.violations).toBe(0)

    // 造一处坏数据（库存为负）→ 报出来，但**不抛异常**（体检不能拖垮服务）
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({ stock: -3, price: 10 }))

    const bad = await runDailyInvariantCheck()
    expect(bad.ok).toBe(false)
    expect(bad.violations).toBeGreaterThan(0)
  }, 30000)
})
