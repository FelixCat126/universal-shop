// ⚠️ 重要：必须在导入任何模块之前设置环境变量！
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 设置测试环境变量 - 使用绝对路径
const projectRoot = path.join(__dirname, '../../')
process.env.NODE_ENV = 'test'
process.env.DATABASE_PATH = path.join(projectRoot, 'database/test.sqlite')
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only-32-chars-long'
process.env.JWT_ADMIN_SECRET = 'test-admin-jwt-secret-key-for-testing-only'

// console.log('📍 项目根目录:', projectRoot)
// console.log('📍 测试数据库路径:', process.env.DATABASE_PATH)

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { TestDatabase } from './test-database.js'

// 测试数据库路径
const TEST_DB_PATH = process.env.DATABASE_PATH

beforeAll(async () => {
  console.log('🧪 初始化测试环境...')
  
  // 初始化测试数据库
  await TestDatabase.initialize()
  await TestDatabase.syncModels()
  
  console.log('✅ 测试环境初始化完成')
})

afterAll(async () => {
  console.log('🧹 清理测试环境...')
  
  // 清理数据库连接
  await TestDatabase.cleanup()
  
  // 清理测试数据库文件
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH)
      console.log('✅ 测试数据库文件已清理')
    } catch (error) {
      console.warn('⚠️ 清理测试数据库文件失败:', error.message)
    }
  }
  
  console.log('✅ 测试环境清理完成')
})

beforeEach(async () => {
  // 每个测试前清理所有数据（保持表结构）
  await TestDatabase.clearAllData()
})

afterEach(async () => {
  // 每个测试后的清理工作（如果需要）
})
