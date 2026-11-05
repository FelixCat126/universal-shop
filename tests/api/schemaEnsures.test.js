/**
 * 生产 schema 准备（schemaEnsures）测试
 *
 * 这一组 ensure* 函数是**生产升级路径**：线上库比代码旧时，
 * 服务启动前靠它们把缺的列/索引/表补回来。
 * 平时测试库的表是"全的"，于是这些"补列"分支一次都跑不到 ——
 * 而它们恰恰是升级时唯一会执行的代码，错了就是「部署后服务起不来」。
 *
 * 测法：**先把列/表删掉**，再跑 prepareSchema()，验证它能补回来。
 *   SE-1 users/administrators/partners 的 token_version 被删 → 补回
 *   SE-2 users.avatar_url / must_reset_password 被删 → 补回
 *   SE-3 products.points / name_th 被删 → 补回
 *   SE-4 orders 的货币与积分列被删 → 补回（且 total_amount_thb 由原值回填）
 *   SE-5 orders.client_order_key 被删 → 补回并重建唯一索引
 *   SE-6 export_jobs 表被删 → 整表重建
 *   SE-7 连续跑两次不报错（幂等），且不会改动既有数据
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { prepareSchema } from '@server/utils/schemaEnsures.js'

const models = () => TestDatabase.getSequelize().models

/** 删列（模拟"线上库比代码旧"） */
async function dropColumn (table, column) {
  await TestDatabase.getSequelize().query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`)
}

/** 删表 */
async function dropTable (table) {
  await TestDatabase.getSequelize().query(`DROP TABLE IF EXISTS "${table}" CASCADE`)
}

/** 表里有没有某列 */
async function hasColumn (table, column) {
  const rows = await TestDatabase.getSequelize().query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = :t AND column_name = :c`,
    { replacements: { t: table, c: column } }
  )
  const list = Array.isArray(rows?.[0]) ? rows[0] : (rows || [])
  return list.length > 0
}

/** 某张表上是否存在名为 name 的索引 */
async function hasIndex (table, name) {
  const rows = await TestDatabase.getSequelize().query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema() AND tablename = :t AND indexname = :n`,
    { replacements: { t: table, n: name } }
  )
  const list = Array.isArray(rows?.[0]) ? rows[0] : (rows || [])
  return list.length > 0
}

describe('生产 schema 准备 schemaEnsures', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
  })

  it('SE-1 token_version 被删后能补回（users/administrators/partners）', async () => {
    for (const t of ['users', 'administrators', 'partners']) {
      await dropColumn(t, 'token_version')
      expect(await hasColumn(t, 'token_version')).toBe(false)
    }

    await prepareSchema()

    for (const t of ['users', 'administrators', 'partners']) {
      expect(await hasColumn(t, 'token_version')).toBe(true)
    }
  }, 30000)

  it('SE-2 users.avatar_url / must_reset_password 被删后能补回', async () => {
    await dropColumn('users', 'avatar_url')
    await dropColumn('users', 'must_reset_password')

    await prepareSchema()

    expect(await hasColumn('users', 'avatar_url')).toBe(true)
    expect(await hasColumn('users', 'must_reset_password')).toBe(true)
  }, 30000)

  it('SE-3 products.points / name_th 被删后能补回', async () => {
    await dropColumn('products', 'points')
    await dropColumn('products', 'name_th')

    await prepareSchema()

    expect(await hasColumn('products', 'points')).toBe(true)
    expect(await hasColumn('products', 'name_th')).toBe(true)
  }, 30000)

  it('SE-4 orders 货币/积分列被删后能补回，且泰铢金额由原值回填', async () => {
    const { Order, User } = models()
    const user = await User.create(await TestDataFactory.createUser({ nickname: 'SE4' }))
    await Order.create({
      user_id: user.id,
      order_no: `SE4${Date.now()}`,
      contact_name: 'SE4',
      contact_phone: '13800000001',
      delivery_address: 'A',
      status: 'shipping',
      total_amount: 123.45,
      exchange_rate: 1
    })

    await dropColumn('orders', 'currency_code')
    await dropColumn('orders', 'total_amount_thb')
    await dropColumn('orders', 'points_redeemed')

    await prepareSchema()

    expect(await hasColumn('orders', 'currency_code')).toBe(true)
    expect(await hasColumn('orders', 'total_amount_thb')).toBe(true)
    expect(await hasColumn('orders', 'points_redeemed')).toBe(true)

    // 回填：total_amount_thb 应由原 total_amount 填出来，currency_code 默认 THB
    const rows = await Order.findAll({ attributes: ['currency_code', 'total_amount_thb'] })
    expect(rows[0].currency_code).toBe('THB')
    expect(Number(rows[0].total_amount_thb)).toBe(123.45)
  }, 30000)

  it('SE-5 orders.client_order_key 被删后能补回并重建唯一索引', async () => {
    await dropColumn('orders', 'client_order_key')
    expect(await hasColumn('orders', 'client_order_key')).toBe(false)

    await prepareSchema()

    expect(await hasColumn('orders', 'client_order_key')).toBe(true)
    // 幂等键唯一索引必须一起重建 —— 没有它并发下单会建出多单
    expect(await hasIndex('orders', 'uniq_orders_user_client_key')).toBe(true)
  }, 30000)

  it('SE-6 export_jobs 表被删后能整表重建', async () => {
    await dropTable('export_jobs')
    expect(await hasColumn('export_jobs', 'admin_id')).toBe(false)

    await prepareSchema()

    expect(await hasColumn('export_jobs', 'admin_id')).toBe(true)
    expect(await hasColumn('export_jobs', 'status')).toBe(true)
    expect(await hasColumn('export_jobs', 'file_path')).toBe(true)
  }, 30000)

  it('SE-7 连续跑两次不报错且不改数据（幂等）', async () => {
    const { User } = models()
    const user = await User.create(await TestDataFactory.createUser({ nickname: 'SE7' }))

    await expect(prepareSchema()).resolves.toBeUndefined()
    await expect(prepareSchema()).resolves.toBeUndefined()

    const after = await User.findByPk(user.id)
    expect(after).not.toBeNull()
    expect(after.nickname).toBe('SE7')
  }, 30000)
})
