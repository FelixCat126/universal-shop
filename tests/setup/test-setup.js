/**
 * 测试入口：在导入任何模块之前必须设置环境变量。
 *
 * 必备：
 *   DATABASE_URL_TEST   测试库连接串（推荐 postgres://shop:shop@127.0.0.1:5432/shop_test）
 *   未设则回退到本地默认；本地用 `npm run db:up` 一键启动 docker PG。
 */

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only-32-chars-long'
process.env.JWT_ADMIN_SECRET = 'test-admin-jwt-secret-key-for-testing-only'
process.env.CAPTCHA_SECRET = 'test-captcha-secret-key-for-testing-only'

// 默认测试库
if (!process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
}
// 并发测试需要较大的连接池（默认 10 在 50 并发时会触发 acquire 超时）
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || '40'
process.env.PG_POOL_ACQUIRE_MS = process.env.PG_POOL_ACQUIRE_MS || '60000'

import { beforeAll, afterAll, beforeEach } from 'vitest'
import { TestDatabase } from './test-database.js'

beforeAll(async () => {
  console.log('🧪 初始化测试环境（PostgreSQL）...')
  await TestDatabase.initialize()
  await TestDatabase.syncModels()
  console.log('✅ 测试环境初始化完成')
})

afterAll(async () => {
  console.log('🧹 清理测试环境...')
  await TestDatabase.cleanup()
  console.log('✅ 测试环境清理完成')
})

beforeEach(async () => {
  await TestDatabase.clearAllData()
})
