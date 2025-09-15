#!/usr/bin/env node

/**
 * 数据种子系统
 * 用于初始化项目的基础数据
 */

// 导入所有模型以确保表结构正确同步
import models from '../models/index.js'
const { 
  sequelize, 
  Administrator, 
  AdministrativeRegion, 
  SystemConfig,
  Order
} = models
import { importThailandData } from './thailandRegions.js'

class DataSeeder {
  static async run() {
    console.log('🌱 开始数据种子初始化...')
    
    try {
      // 1. 确保数据库连接
      await sequelize.authenticate()
      console.log('✅ 数据库连接成功')
      
      // 2. 智能同步表结构
      await this.smartSync()
      console.log('✅ 数据库表结构同步完成')
      
      // 3. 创建默认系统配置
      await this.createDefaultSystemConfig()
      
      // 4. 创建默认管理员
      await this.createDefaultAdmin()
      
      // 5. 导入泰国行政区数据
      await this.importAdministrativeRegions()
      
      // 6. 验证数据库完整性
      await this.verifyDatabaseIntegrity()
      
      console.log('🎉 数据种子初始化完成！')
      
    } catch (error) {
      console.error('❌ 数据种子初始化失败:', error)
      throw error
    }
  }
  
  static async smartSync() {
    try {
      // 检查是否是全新安装（通过检查是否有任何表存在）
      const tables = await sequelize.getQueryInterface().showAllTables()
      const isFirstInstall = tables.length === 0
      
      if (isFirstInstall) {
        console.log('🆕 检测到全新安装，创建数据库表...')
        // 全新安装，强制重建所有表
        await sequelize.sync({ force: true })
      } else {
        console.log('🔄 检测到现有数据库，尝试安全更新...')
        try {
          // 尝试安全的alter操作
          await sequelize.sync({ alter: true })
        } catch (error) {
          console.warn('⚠️  安全更新失败，尝试更保守的策略...')
          // 如果alter失败，只同步新表，不修改现有表
          await sequelize.sync()
          
          // 手动添加缺失的列
          await this.addMissingColumns()
        }
      }
    } catch (error) {
      console.error('❌ 数据库同步失败:', error)
      throw error
    }
  }
  
  static async addMissingColumns() {
    try {
      console.log('🔧 检查并添加缺失的数据库列...')
      
      // 检查orders表是否有exchange_rate字段
      const [orderColumns] = await sequelize.query(`PRAGMA table_info(orders)`)
      const hasExchangeRate = orderColumns.some(col => col.name === 'exchange_rate')
      
      if (!hasExchangeRate) {
        console.log('➕ 为orders表添加exchange_rate字段')
        await sequelize.query(`
          ALTER TABLE orders 
          ADD COLUMN exchange_rate DECIMAL(10, 4) DEFAULT 1.0000
        `)
      }
      
      // 检查products表是否有alias字段
      const [productColumns] = await sequelize.query(`PRAGMA table_info(products)`)
      const hasAlias = productColumns.some(col => col.name === 'alias')
      
      if (!hasAlias) {
        console.log('➕ 为products表添加alias字段')
        await sequelize.query(`
          ALTER TABLE products 
          ADD COLUMN alias VARCHAR(200)
        `)
      }
      
      console.log('✅ 数据库列检查完成')
    } catch (error) {
      console.warn('⚠️  添加缺失列时出现错误:', error.message)
      // 不抛出错误，让流程继续
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
  
  static async createDefaultSystemConfig() {
    try {
      console.log('⚙️  初始化系统配置...')
      
      // 默认配置项
      const defaultConfigs = [
        {
          config_key: 'exchange_rate',
          config_value: '1.0000',
          description: '汇算比例配置',
          config_type: 'number'
        },
        {
          config_key: 'db_version',
          config_value: '1.1.0', // 包含 exchange_rate 字段的版本
          description: '数据库Schema版本',
          config_type: 'text'
        }
      ]
      
      for (const config of defaultConfigs) {
        const existing = await SystemConfig.findOne({
          where: { config_key: config.config_key }
        })
        
        if (!existing) {
          await SystemConfig.create(config)
          console.log(`✅ 创建系统配置: ${config.config_key} = ${config.config_value}`)
        } else {
          console.log(`ℹ️  系统配置已存在: ${config.config_key}`)
        }
      }
      
    } catch (error) {
      console.error('❌ 创建默认系统配置失败:', error)
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
  
  static async verifyDatabaseIntegrity() {
    try {
      console.log('🔍 验证数据库完整性...')
      
      // 检查关键表是否存在必要字段
      const [orderColumns] = await sequelize.query(`PRAGMA table_info(orders)`)
      const hasExchangeRate = orderColumns.some(col => col.name === 'exchange_rate')
      
      if (hasExchangeRate) {
        console.log('✅ Order表包含exchange_rate字段')
      } else {
        console.warn('⚠️  Order表缺少exchange_rate字段')
      }
      
      // 检查数据库版本
      const versionConfig = await SystemConfig.findOne({
        where: { config_key: 'db_version' }
      })
      
      if (versionConfig) {
        console.log(`✅ 数据库版本: ${versionConfig.config_value}`)
      } else {
        console.warn('⚠️  数据库版本信息缺失')
      }
      
      // 检查汇率配置
      const exchangeConfig = await SystemConfig.findOne({
        where: { config_key: 'exchange_rate' }
      })
      
      if (exchangeConfig) {
        console.log(`✅ 汇率配置: ${exchangeConfig.config_value}`)
      } else {
        console.warn('⚠️  汇率配置缺失')
      }
      
    } catch (error) {
      console.error('❌ 数据库完整性验证失败:', error)
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
