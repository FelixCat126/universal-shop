#!/usr/bin/env node

/**
 * 测试环境准备：PostgreSQL 版本
 * 不再依赖 SQLite 文件，而是连到 DATABASE_URL_TEST 指向的 PG 实例。
 *
 * 使用前请确保 PG 已就绪：
 *   npm run db:up
 */

import { TestDatabase } from './test-database.js'

async function prepareTestEnvironment () {
  console.log('🛠️ 准备测试环境（PostgreSQL）...')

  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = process.env.JWT_SECRET ||
    'test-jwt-secret-key-for-testing-only-32-chars-long'
  process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ||
    'test-admin-jwt-secret-key-for-testing-only'
  process.env.JWT_PARTNER_SECRET = process.env.JWT_PARTNER_SECRET ||
    'test-partner-jwt-secret-key-for-testing-only'
  if (!process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
  }

  try {
    const seq = await TestDatabase.initialize()

    /**
     * 这里**不再**把模型同步进 public。
     *
     * 每个测试文件现在用**自己独立的 schema**（t_<pid>_<随机>），
     * 表结构由各文件在 beforeAll 里自建 —— 所以「提前在 public 建一套」不仅没用，
     * 还会坏事：
     *   - public 里会多出一整套同名表（users/orders/...）和同名 enum 类型；
     *   - PG 的 enum 类型名跨 schema **不唯一**，而 Sequelize 的 describeTable
     *     里那段标量子查询按 typname 匹配、**没有 schema 限定** →
     *     "more than one row returned by a subquery used as an expression"
     *     → prepareSchema() 中断 → 幂等等唯一索引建不出来 →
     *     大量用例随机失败（并发下单建出 5 单、断言条数不对……）。
     *
     * 所以这里只做两件事：确认库连得上、清掉上次跑崩留下的残留 schema。
     */
    await TestDatabase.dropStaleSchemas(seq)
    await TestDatabase.cleanup()

    console.log('✅ 测试库可连接，残留 schema 已清理')
    console.log('ℹ️ 每个测试文件会自动创建独立 schema 并自建表，无需手动准备')
    console.log('')
    console.log('运行：')
    console.log('  npm run test:integration')
    console.log('  npm run test:api')
  } catch (error) {
    console.error('❌ 测试环境准备失败：', error.message)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prepareTestEnvironment()
}
