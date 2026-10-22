/**
 * Schema 准备链（6 用例）
 *
 * 背景：生产部署脚本 production-deploy-setup.mjs 会跑 seeder，而 seeder 查询
 * token_version 等新增列。这些列由 prepareSchema() 创建。若 setup 脚本先于
 * app.js 启动链执行，列还不存在 → seeder 抛 "column does not exist" →
 * 部署中断且 PM2 服务停机（真实发生过一次）。
 *
 * 这些缺陷在常规测试中不可见，因为 app.js 的启动链在 NODE_ENV=test 下不执行。
 * 因此本文件直接对 prepareSchema 的产物做断言。
 */
import { describe, it, expect } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { prepareSchema } from '@server/utils/schemaEnsures.js'

/**
 * 注意：setupFiles 的 beforeAll 会先 DROP 全部表再逐个重建（syncModels），
 * 所以本文件的用例体（it 内）执行时表结构才存在。
 * 绝不能把 prepareSchema 放在本文件顶层 beforeAll —— 那时表刚被 DROP，
 * 会出现 "No description found for users table"。
 */

describe('Schema.prepareSchema', () => {
  it('SR-1 prepareSchema 导出且可重复执行（幂等）', async () => {
    const sequelize = TestDatabase.getSequelize()
    expect(typeof prepareSchema).toBe('function')
    await expect(prepareSchema()).resolves.toBeUndefined()
  })

  it('SR-2 users/administrators/partners 均有 token_version 列（seeder 依赖）', async () => {
    const sequelize = TestDatabase.getSequelize()
    const qi = sequelize.getQueryInterface()
    for (const table of ['users', 'administrators', 'partners']) {
      const desc = await qi.describeTable(table)
      expect(desc.token_version, `${table} 缺 token_version`).toBeDefined()
      // describeTable 返回的 type 是字符串形式（'INTEGER'）
      expect(String(desc.token_version.type)).toMatch(/INT/i)
    }
  })

  it('SR-3 orders 有货币与积分列（结算/积分链依赖）', async () => {
    const sequelize = TestDatabase.getSequelize()
    const desc = await sequelize.getQueryInterface().describeTable('orders')
    expect(desc.currency_code).toBeDefined()
    expect(desc.total_amount_thb).toBeDefined()
    expect(desc.points_redeemed).toBeDefined()
  })

  it('SR-4 orders 有 client_order_key（幂等下单依赖）', async () => {
    const sequelize = TestDatabase.getSequelize()
    const desc = await sequelize.getQueryInterface().describeTable('orders')
    expect(desc.client_order_key).toBeDefined()
  })

  it('SR-5 users 有 must_reset_password 与 avatar_url（游客注册/头像依赖）', async () => {
    const sequelize = TestDatabase.getSequelize()
    const desc = await sequelize.getQueryInterface().describeTable('users')
    expect(desc.must_reset_password).toBeDefined()
    expect(desc.avatar_url).toBeDefined()
  })

  it('SR-6 after_sales 表已建（售后流程依赖）', async () => {
    const sequelize = TestDatabase.getSequelize()
    // sequelize.query 返回 [rows, metadata]，rows 才是结果集
    const [rows] = await sequelize.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'after_sales'"
    )
    expect(rows[0].n).toBe(1)
  })
})
