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
import { ensureProductCategoriesMigrate } from '../utils/ensureProductCategoriesMigrate.js'

class DataSeeder {
  static async run() {
    console.log('🌱 开始数据种子初始化...')

    // 生产事故守卫：本入口历史行为会把 admin 密码强制重置为 123456，
    // 误对生产 DATABASE_URL 执行即事故。生产环境下拒绝重置密码
    // （结构同步/默认配置/行政区数据仍执行），生产部署请使用 runProductionUpdate()
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction) {
      console.warn('🚫 检测到 NODE_ENV=production：本次 seed 不会重置管理员密码')
      console.warn('   生产环境增量部署请改用 runProductionUpdate()（见 scripts/production-deploy-setup.mjs）')
    } else {
      console.warn('⚠️  警告：本命令会将 admin 密码强制重置为 123456，仅限本地/测试环境，切勿对生产数据库执行！')
    }

    try {
      // 1. 确保数据库连接
      await sequelize.authenticate()
      console.log('✅ 数据库连接成功')

      // 2. 智能同步表结构
      await this.smartSync()
      console.log('✅ 数据库表结构同步完成')

      // 3. 创建默认系统配置
      await this.createDefaultSystemConfig()

      // 4. 创建默认管理员（本地/首次安装：允许重置为默认密码；生产环境禁止重置）
      await this.createDefaultAdmin({ allowPasswordReset: !isProduction })
      
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

  /**
   * 生产环境增量部署：仅同步表结构、补默认配置与参考数据，不修改已有业务数据与管理员密码
   */
  static async runProductionUpdate() {
    console.log('🌱 生产部署：结构升级与数据保护模式...')
    
    try {
      await sequelize.authenticate()
      console.log('✅ 数据库连接成功')
      
      await this.smartSync()
      console.log('✅ 数据库表结构同步完成')

      await ensureProductCategoriesMigrate()
      console.log('✅ 商品分类表与 products.category_id 增量迁移已完成（幂等，不覆盖既有分类赋值）')

      await this.createDefaultSystemConfig()
      
      await this.createDefaultAdmin({ allowPasswordReset: false })
      
      await this.importAdministrativeRegions()
      
      await this.verifyDatabaseIntegrity()
      
      console.log('🎉 生产部署数据库步骤完成（未改动现有业务数据与管理员密码）')
      
    } catch (error) {
      console.error('❌ 生产部署数据库步骤失败:', error)
      throw error
    }
  }
  
  static async smartSync() {
    try {
      const tables = await sequelize.getQueryInterface().showAllTables()
      const isFirstInstall = tables.length === 0

      if (isFirstInstall) {
        console.log('🆕 全新安装：根据模型创建表（不使用 force，避免误删生产数据）')
      } else {
        console.log('🔄 已有数据库：先执行 SQL 补丁（补列等），再 Sequelize sync')
        await this.applySqlPatchesOnly()
      }

      // 绝不使用 sync({ force: true })，以免 DROP 表；新建库时空库 sync 仅 CREATE
      await sequelize.sync()

      if (isFirstInstall) {
        await this.applySqlPatchesOnly()
      }

    } catch (error) {
      console.error('❌ 数据库同步失败:', error)
      throw error
    }
  }

  static async applySqlPatchesOnly() {
    try {
      console.log('🔧 检查可选 SQL 补丁（scripts/db/patches/，无文件则跳过）...')
      const { applySqlPatches } = await import('../../../scripts/db/apply-sql-patches.mjs')
      await applySqlPatches(sequelize)
      console.log('✅ SQL 补丁已执行')
    } catch (error) {
      console.error('❌ SQL 补丁步骤失败:', error)
      throw error
    }
  }

  static async createDefaultAdmin(options = {}) {
    const allowPasswordReset = options.allowPasswordReset !== false
    
    try {
      const existingAdmin = await Administrator.findOne({ where: { username: 'admin' } })
      if (existingAdmin) {
        if (allowPasswordReset) {
          // 本地开发 / npm run setup：强制重置密码为123456，确保始终可用
          existingAdmin.password = '123456'
          await existingAdmin.save()
          console.log('✅ 默认管理员密码已重置为123456')
          console.log('   用户名: admin')
          console.log('   密码: 123456')
        } else {
          console.log('ℹ️  生产部署：检测到已有管理员，不修改密码与账户信息')
        }
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
          config_value: '0.00',
          description: '兼容字段：与 exchange_rates.USD（USDT）同步',
          config_type: 'text'
        },
        {
          config_key: 'exchange_rates',
          config_value: JSON.stringify({ USD: '0.00', CNY: '0.00', MYR: '0.00' }),
          description: '多币种汇算 USD|CNY|MYR（相对泰铢标价）',
          config_type: 'json'
        },
        {
          config_key: 'currency_unit',
          config_value: 'THB',
          description: '全站货币代码：THB 泰铢 | USD 美元 | CNY 人民币',
          config_type: 'text'
        },
        {
          config_key: 'db_version',
          config_value: '1.1.0', // 包含 exchange_rate 字段的版本
          description: '数据库Schema版本',
          config_type: 'text'
        },
        {
          config_key: 'partner_order_moq_unit',
          config_value: '50',
          description: '合作方批发单条明细最小起订量（件）',
          config_type: 'text'
        },
        {
          config_key: 'partner_order_moq_multiplier',
          config_value: '1',
          description: '合作方单 SKU 增量步长（1 表示仅下限起订后可逐件递增）',
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
      
      // 检查关键表是否存在必要字段（PG）
      const orderDesc = await sequelize.getQueryInterface().describeTable('orders').catch(() => ({}))
      if ('exchange_rate' in orderDesc) {
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
