#!/usr/bin/env node

/**
 * 测试环境准备脚本
 * 用于在运行测试前准备必要的环境和数据
 */

import { TestDatabase } from './test-database.js'
import fs from 'fs'
import path from 'path'

async function prepareTestEnvironment() {
  console.log('🛠️ 准备测试环境...')
  
  try {
    // 设置环境变量
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_PATH = './database/test.sqlite'
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only-32-chars-long'
    
    // 确保测试目录存在
    const testDirs = [
      'tests/unit/models',
      'tests/unit/utils', 
      'tests/integration',
      'tests/api',
      'tests/e2e',
      'database'
    ]
    
    for (const dir of testDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        console.log(`✅ 创建目录: ${dir}`)
      }
    }
    
    // 初始化测试数据库
    await TestDatabase.initialize()
    await TestDatabase.syncModels()
    
    console.log('🎉 测试环境准备完成!')
    console.log('')
    console.log('现在可以运行以下测试命令:')
    console.log('- npm run test          # 交互式测试')
    console.log('- npm run test:unit     # 单元测试')
    console.log('- npm run test:api      # API测试')
    console.log('- npm run test:coverage # 覆盖率测试')
    console.log('- npm run test:watch    # 监听模式')
    
  } catch (error) {
    console.error('❌ 测试环境准备失败:', error.message)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  prepareTestEnvironment()
}
