#!/usr/bin/env node

/**
 * 测试环境清理脚本
 * 用于清理测试后的环境和临时文件
 */

import { TestDatabase } from './test-database.js'
import fs from 'fs'
import path from 'path'

async function cleanupTestEnvironment() {
  console.log('🧹 清理测试环境...')
  
  try {
    // 清理数据库连接
    await TestDatabase.cleanup()
    
    // 清理测试数据库文件
    const testDbPath = './database/test.sqlite'
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
      console.log('✅ 删除测试数据库文件')
    }
    
    // 清理测试覆盖率报告
    const coverageDir = './coverage'
    if (fs.existsSync(coverageDir)) {
      fs.rmSync(coverageDir, { recursive: true, force: true })
      console.log('✅ 清理覆盖率报告')
    }
    
    // 清理临时测试文件
    const tempFiles = [
      './test-results.xml',
      './junit.xml'
    ]
    
    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        console.log(`✅ 删除临时文件: ${file}`)
      }
    }
    
    console.log('🎉 测试环境清理完成!')
    
  } catch (error) {
    console.error('❌ 测试环境清理失败:', error.message)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestEnvironment()
}
