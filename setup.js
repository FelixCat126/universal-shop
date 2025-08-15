#!/usr/bin/env node

import sequelize from './src/server/config/database.js'
import Administrator from './src/server/models/Administrator.js'

console.log('🚀 初始化 Universal Shop...')

async function setup() {
  try {
    // 连接数据库并同步模型
    await sequelize.authenticate()
    await sequelize.sync({ alter: false })
    console.log('✅ 数据库连接成功')
    
    // 检查是否已有管理员
    const existingAdmin = await Administrator.findOne()
    if (existingAdmin) {
      console.log('✅ 系统已初始化，管理员账户已存在')
      return
    }
    
    // 创建超级管理员
    await Administrator.create({
      username: 'admin',
      password: 'admin123',
      role: 'super_admin',
      real_name: '超级管理员',
      is_active: true
    })
    
    console.log('✅ 超级管理员创建成功')
    console.log('📋 登录信息: 用户名 admin, 密码 admin123')
    
  } catch (error) {
    console.error('❌ 初始化失败:', error.message)
    process.exit(1)
  } finally {
    await sequelize.close()
  }
}

setup()
