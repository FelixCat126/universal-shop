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
  if (!process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
  }

  try {
    await TestDatabase.initialize()
    await TestDatabase.syncModels()
    await TestDatabase.cleanup()

    console.log('🎉 测试环境准备完成')
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
