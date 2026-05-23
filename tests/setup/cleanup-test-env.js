#!/usr/bin/env node

/**
 * 测试环境清理（PG 版本）：DROP 所有表 + 关闭连接 + 删除覆盖率报告
 */

import fs from 'fs'
import { TestDatabase } from './test-database.js'

async function cleanupTestEnvironment () {
  console.log('🧹 清理测试环境...')
  try {
    process.env.NODE_ENV = 'test'
    if (!process.env.DATABASE_URL_TEST) {
      process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
    }

    const seq = await TestDatabase.initialize()
    try {
      await seq.drop()
      console.log('✅ 测试库表已 DROP')
    } catch (e) {
      console.warn('⚠️ DROP 阶段：', e.message)
    }
    await TestDatabase.cleanup()

    const coverageDir = './coverage'
    if (fs.existsSync(coverageDir)) {
      fs.rmSync(coverageDir, { recursive: true, force: true })
      console.log('✅ 清理覆盖率报告')
    }
    for (const f of ['./test-results.xml', './junit.xml']) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f)
        console.log(`✅ 删除临时文件: ${f}`)
      }
    }

    console.log('🎉 测试环境清理完成')
  } catch (error) {
    console.error('❌ 测试环境清理失败：', error.message)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestEnvironment()
}
