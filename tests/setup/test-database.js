import fs from 'fs'
import path from 'path'

let sequelize = null

export class TestDatabase {
  static async initialize() {
    if (sequelize) return sequelize
    
    const dbPath = process.env.DATABASE_PATH || './database/test.sqlite'
    
    // 确保数据库目录存在
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    
    // 导入模型模块（会创建sequelize实例，并读取环境变量）
    const modelsModule = await import('../../src/server/models/index.js')
    sequelize = modelsModule.sequelize
    
    // 测试连接
    try {
      await sequelize.authenticate()
      console.log('✅ 测试数据库连接成功')
    } catch (error) {
      console.error('❌ 测试数据库连接失败:', error)
      throw error
    }
    
    console.log('✅ 所有数据库模型已导入')
    
    return sequelize
  }
  
  static async syncModels() {
    if (!sequelize) {
      throw new Error('数据库未初始化，请先调用 initialize()')
    }
    
    try {
      // SQLite: 禁用外键约束，然后重建表
      await sequelize.query('PRAGMA foreign_keys = OFF;')
      
      // 强制同步所有表（测试环境下重建表结构）
      await sequelize.sync({ force: true })
      
      // 重新启用外键约束
      await sequelize.query('PRAGMA foreign_keys = ON;')
      
      console.log('✅ 测试数据库表结构同步完成')
    } catch (error) {
      console.error('❌ syncModels失败:', error.message)
      throw error
    }
  }
  
  static async cleanup() {
    if (sequelize) {
      await sequelize.close()
      sequelize = null
      console.log('✅ 测试数据库连接已关闭')
    }
  }
  
  static async clearAllData() {
    if (!sequelize) return
    
    try {
      // 暂时禁用外键约束
      await sequelize.query('PRAGMA foreign_keys = OFF;')
      
      // 获取所有模型
      const models = Object.values(sequelize.models)
      
      // 按依赖关系倒序删除数据
      const deleteOrder = [
        'OrderItem', 'Order', 'Cart', 'Address', 
        'OperationLog', 'User', 'Administrator', 
        'Product', 'SystemConfig', 'AdministrativeRegion'
      ]
      
      for (const modelName of deleteOrder) {
        const model = models.find(m => m.name === modelName)
        if (model) {
          await model.destroy({ where: {}, force: true })
        }
      }
      
      // 重新启用外键约束
      await sequelize.query('PRAGMA foreign_keys = ON;')
      
      console.log('✅ 测试数据已清理')
    } catch (error) {
      console.warn('⚠️ 清理测试数据失败:', error.message)
    }
  }
  
  static getSequelize() {
    return sequelize
  }
}
