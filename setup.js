#!/usr/bin/env node

import DataSeeder from './src/server/seeds/index.js'

console.log('🚀 初始化 Universal Shop...')

async function setup() {
  try {
    await DataSeeder.run()
    
    console.log('')
    console.log('🎉 Universal Shop 初始化完成！')
    console.log('现在可以运行 npm run dev 启动开发服务器')
    console.log('')
    console.log('🔐 默认管理员账户:')
    console.log('   用户名: admin')
    console.log('   密码: 123456')
    
  } catch (error) {
    console.error('❌ 初始化失败:', error)
    process.exit(1)
  }
}

setup()
