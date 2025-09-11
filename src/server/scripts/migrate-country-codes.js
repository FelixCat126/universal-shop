#!/usr/bin/env node

/**
 * 数据库迁移脚本：手机号国际化改造
 * 
 * 用法:
 *   node src/server/scripts/migrate-country-codes.js
 * 
 * 功能:
 *   1. 为用户表添加 country_code 字段
 *   2. 为地址表添加 contact_country_code 字段
 *   3. 为现有数据设置默认区号 +86
 *   4. 创建复合唯一索引以支持不同国家相同手机号
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, existsSync } from 'fs'
import sqlite3 from 'sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库文件路径
const DB_PATH = join(__dirname, '../../../database/shop.sqlite')
const MIGRATION_SQL_PATH = join(__dirname, '../migrations/001-add-country-codes.sql')

// 检查数据库文件是否存在
if (!existsSync(DB_PATH)) {
  console.error('❌ 数据库文件不存在:', DB_PATH)
  console.error('请先创建数据库或检查路径是否正确')
  process.exit(1)
}

// 检查迁移SQL文件是否存在
if (!existsSync(MIGRATION_SQL_PATH)) {
  console.error('❌ 迁移SQL文件不存在:', MIGRATION_SQL_PATH)
  process.exit(1)
}

console.log('🚀 开始执行数据库迁移...')
console.log('📁 数据库路径:', DB_PATH)
console.log('📄 迁移文件:', MIGRATION_SQL_PATH)
console.log()

// 创建数据库连接
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 连接数据库失败:', err.message)
    process.exit(1)
  }
  console.log('✅ 数据库连接成功')
})

// 读取迁移SQL
let migrationSQL
try {
  migrationSQL = readFileSync(MIGRATION_SQL_PATH, 'utf8')
  console.log('✅ 迁移SQL读取成功')
} catch (err) {
  console.error('❌ 读取迁移SQL失败:', err.message)
  process.exit(1)
}

// 执行迁移前备份提醒
console.log()
console.log('⚠️  重要提醒：')
console.log('   1. 请确保已备份数据库')
console.log('   2. 此操作将修改表结构')
console.log('   3. 建议在测试环境先验证')
console.log()

// 检查是否已经执行过迁移
const checkMigrationStatus = () => {
  return new Promise((resolve, reject) => {
    db.get("PRAGMA table_info(users)", (err, row) => {
      if (err) {
        reject(err)
        return
      }
      
      // 检查是否已有 country_code 字段
      db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err) {
          reject(err)
          return
        }
        
        const hasCountryCode = columns.some(col => col.name === 'country_code')
        resolve(hasCountryCode)
      })
    })
  })
}

// 执行迁移
const runMigration = async () => {
  try {
    // 检查是否已经迁移过
    const alreadyMigrated = await checkMigrationStatus()
    
    if (alreadyMigrated) {
      console.log('⚠️  检测到数据库已经包含 country_code 字段')
      console.log('   迁移可能已经执行过，是否继续？')
      console.log('   如果继续，可能会导致数据重复或错误')
      console.log()
      
      // 在生产环境中，这里应该询问用户确认
      // 为了自动化，我们直接退出
      console.log('🛑 为安全起见，停止执行迁移')
      console.log('   如需强制执行，请手动运行 SQL 脚本')
      process.exit(0)
    }

    // 执行迁移SQL
    await new Promise((resolve, reject) => {
      db.exec(migrationSQL, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })

    console.log('✅ 数据库迁移执行完成！')
    console.log()

    // 验证迁移结果
    console.log('🔍 正在验证迁移结果...')
    
    // 检查用户表
    await new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN country_code IS NULL THEN 1 END) as null_country_codes,
          COUNT(CASE WHEN country_code = '+86' THEN 1 END) as china_users,
          COUNT(CASE WHEN country_code = '+66' THEN 1 END) as thailand_users,
          COUNT(CASE WHEN country_code = '+60' THEN 1 END) as malaysia_users
        FROM users
      `, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        
        console.log('📊 用户表统计:')
        console.log(`   总用户数: ${result.total_users}`)
        console.log(`   无区号: ${result.null_country_codes}`)
        console.log(`   中国用户: ${result.china_users}`)
        console.log(`   泰国用户: ${result.thailand_users}`)
        console.log(`   马来西亚用户: ${result.malaysia_users}`)
        resolve()
      })
    })

    // 检查地址表
    await new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          COUNT(*) as total_addresses,
          COUNT(CASE WHEN contact_country_code IS NULL THEN 1 END) as null_contact_codes,
          COUNT(CASE WHEN contact_country_code = '+86' THEN 1 END) as china_addresses,
          COUNT(CASE WHEN contact_country_code = '+66' THEN 1 END) as thailand_addresses,
          COUNT(CASE WHEN contact_country_code = '+60' THEN 1 END) as malaysia_addresses
        FROM addresses
      `, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        
        console.log('📊 地址表统计:')
        console.log(`   总地址数: ${result.total_addresses}`)
        console.log(`   无区号: ${result.null_contact_codes}`)
        console.log(`   中国地址: ${result.china_addresses}`)
        console.log(`   泰国地址: ${result.thailand_addresses}`)
        console.log(`   马来西亚地址: ${result.malaysia_addresses}`)
        resolve()
      })
    })

    console.log()
    console.log('🎉 迁移完成！现在系统支持以下功能:')
    console.log('   ✨ 用户注册时可选择国家区号')
    console.log('   ✨ 支持中国(+86)、泰国(+66)、马来西亚(+60)')
    console.log('   ✨ 不同国家可使用相同手机号注册')
    console.log('   ✨ 地址管理支持国际手机号')
    console.log('   ✨ 后台管理显示完整手机号信息')

  } catch (error) {
    console.error('❌ 迁移执行失败:', error.message)
    console.error()
    console.error('可能的解决方案:')
    console.error('1. 检查数据库文件是否存在写权限')
    console.error('2. 确保数据库不被其他进程占用')
    console.error('3. 检查SQL语法是否正确')
    console.error('4. 恢复数据库备份后重试')
    process.exit(1)
  } finally {
    // 关闭数据库连接
    db.close((err) => {
      if (err) {
        console.error('⚠️  关闭数据库连接时发生错误:', err.message)
      } else {
        console.log('✅ 数据库连接已关闭')
      }
    })
  }
}

// 执行迁移
runMigration().catch((error) => {
  console.error('💥 迁移过程中发生未处理的错误:', error)
  process.exit(1)
})
