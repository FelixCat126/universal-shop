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
        // 全新安装，使用force重建所有表
        await sequelize.sync({ force: true })
      } else {
        console.log('🔄 检测到现有数据库，使用保守的安全更新策略...')
        // 不使用alter: true，因为它可能会错误地添加约束
        // 而是使用基本sync加上手动列添加
        await sequelize.sync()
        
        // 手动添加缺失的列和修复约束
        await this.addMissingColumns()
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
      
      // 检查orders表是否有地址分字段
      const hasProvince = orderColumns.some(col => col.name === 'province')
      const hasCity = orderColumns.some(col => col.name === 'city')
      const hasDistrict = orderColumns.some(col => col.name === 'district')
      const hasPostalCode = orderColumns.some(col => col.name === 'postal_code')
      
      if (!hasProvince) {
        console.log('➕ 为orders表添加province字段')
        await sequelize.query(`ALTER TABLE orders ADD COLUMN province VARCHAR(50)`)
      }
      
      if (!hasCity) {
        console.log('➕ 为orders表添加city字段')
        await sequelize.query(`ALTER TABLE orders ADD COLUMN city VARCHAR(50)`)
      }
      
      if (!hasDistrict) {
        console.log('➕ 为orders表添加district字段')
        await sequelize.query(`ALTER TABLE orders ADD COLUMN district VARCHAR(50)`)
      }
      
      if (!hasPostalCode) {
        console.log('➕ 为orders表添加postal_code字段')
        await sequelize.query(`ALTER TABLE orders ADD COLUMN postal_code VARCHAR(10)`)
      }
      
      console.log('✅ 数据库列检查完成')
      
      // 修复错误的约束
      await this.fixIncorrectConstraints()
    } catch (error) {
      console.warn('⚠️  添加缺失列时出现错误:', error.message)
      // 不抛出错误，让流程继续
    }
  }
  
  static async fixIncorrectConstraints() {
    try {
      console.log('🔧 检查并修复错误的数据库约束...')
      
      // 检查购物车表是否有错误的约束
      const [cartTableInfo] = await sequelize.query(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='carts'
      `)
      
      if (cartTableInfo.length > 0) {
        const tableSQL = cartTableInfo[0].sql
        
        // 检查是否有错误的单字段UNIQUE约束
        const hasUserIdUnique = tableSQL.includes('user_id') && tableSQL.includes('UNIQUE') && !tableSQL.includes('user_id`, `product_id')
        const hasProductIdUnique = tableSQL.includes('product_id') && tableSQL.includes('UNIQUE') && !tableSQL.includes('user_id`, `product_id')
        
        if (hasUserIdUnique || hasProductIdUnique) {
          console.log('🔨 发现购物车表的错误约束，正在重建表结构...')
          
          // 备份数据
          await sequelize.query(`CREATE TABLE carts_backup AS SELECT * FROM carts`)
          
          // 删除原表
          await sequelize.query(`DROP TABLE carts`)
          
          // 重新创建正确的表结构
          await sequelize.query(`
            CREATE TABLE carts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER REFERENCES users(id),
              session_id VARCHAR(200),
              product_id INTEGER NOT NULL REFERENCES products(id),
              quantity INTEGER NOT NULL DEFAULT 1,
              price DECIMAL(10,2) NOT NULL,
              created_at DATETIME NOT NULL,
              updated_at DATETIME NOT NULL
            )
          `)
          
          // 创建正确的索引
          await sequelize.query(`CREATE INDEX carts_user_id ON carts(user_id)`)
          await sequelize.query(`CREATE INDEX carts_session_id ON carts(session_id)`)  
          await sequelize.query(`CREATE INDEX carts_product_id ON carts(product_id)`)
          await sequelize.query(`CREATE UNIQUE INDEX unique_user_product ON carts(user_id, product_id)`)
          
          // 恢复数据（如果有的话）
          try {
            await sequelize.query(`INSERT INTO carts SELECT * FROM carts_backup`)
            console.log('✅ 购物车数据已恢复')
          } catch (error) {
            console.log('ℹ️  没有需要恢复的购物车数据')
          }
          
          // 删除备份表
          await sequelize.query(`DROP TABLE carts_backup`)
          
          console.log('✅ 购物车表约束已修复')
        }
      }
      
      // 检查用户表的约束问题
      const [userTableInfo] = await sequelize.query(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='users'
      `)
      
      if (userTableInfo.length > 0) {
        const tableSQL = userTableInfo[0].sql
        
        // 检查是否有错误的单字段UNIQUE约束（country_code或phone单独unique）
        const hasCountryCodeUnique = tableSQL.includes('country_code') && tableSQL.includes('UNIQUE') && !tableSQL.includes('country_code`, `phone')
        const hasPhoneUnique = tableSQL.includes('phone') && tableSQL.includes('UNIQUE') && !tableSQL.includes('country_code`, `phone')
        
        if (hasCountryCodeUnique || hasPhoneUnique) {
          console.log('🔨 发现用户表的错误约束，需要手动修复')
          console.log('⚠️  用户表包含重要数据，请在合适的时机手动执行约束修复')
        }
      }
      
      console.log('✅ 数据库约束检查完成')
    } catch (error) {
      console.warn('⚠️  修复约束时出现错误:', error.message)
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
