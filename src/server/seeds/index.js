#!/usr/bin/env node

/**
 * 数据种子系统
 * 用于初始化项目的基础数据
 */

import sequelize from '../config/database.js'
import Administrator from '../models/Administrator.js'
import AdministrativeRegion from '../models/AdministrativeRegion.js'
import { importThailandData } from './thailandRegions.js'

class DataSeeder {
  static async run() {
    console.log('🌱 开始数据种子初始化...')
    
    try {
      // 1. 确保数据库连接
      await sequelize.authenticate()
      console.log('✅ 数据库连接成功')
      
      // 2. 同步表结构
      await sequelize.sync({ alter: true })
      console.log('✅ 数据库表结构同步完成')
      
      // 3. 创建默认管理员
      await this.createDefaultAdmin()
      
      // 4. 导入泰国行政区数据
      await this.importAdministrativeRegions()
      
      console.log('🎉 数据种子初始化完成！')
      
    } catch (error) {
      console.error('❌ 数据种子初始化失败:', error)
      throw error
    }
  }
  
  static async createDefaultAdmin() {
    try {
      const existingAdmin = await Administrator.findOne({ where: { username: 'admin' } })
      if (existingAdmin) {
        // 强制重置密码为123456，确保始终可用
        existingAdmin.password = '123456'
        await existingAdmin.save()
        console.log('✅ 默认管理员密码已重置为123456')
        console.log('   用户名: admin')
        console.log('   密码: 123456')
        return
      }
      
      const admin = await Administrator.create({
        username: 'admin',
        password: '123456',
        email: 'admin@example.com',
        role: 'super_admin',
        permissions: JSON.stringify(['*']),
        is_active: true
      })
      
      console.log('✅ 默认管理员创建成功')
      console.log('   用户名: admin')
      console.log('   密码: 123456')
      
    } catch (error) {
      console.error('❌ 创建默认管理员失败:', error)
      throw error
    }
  }
  
  static async importAdministrativeRegions() {
    try {
      const count = await AdministrativeRegion.count()
      if (count > 0) {
        console.log(`ℹ️  行政区数据已存在 (${count} 条记录)，跳过导入`)
        return
      }
      
      console.log('📍 开始导入泰国行政区数据...')
      await importThailandData()
      
      const finalCount = await AdministrativeRegion.count()
      console.log(`✅ 泰国行政区数据导入完成 (${finalCount} 条记录)`)
      
    } catch (error) {
      console.error('❌ 导入行政区数据失败:', error)
      throw error
    }
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  DataSeeder.run()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('数据种子初始化失败:', error)
      process.exit(1)
    })
}

export default DataSeeder
