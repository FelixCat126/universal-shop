#!/usr/bin/env node

// 检查数据库中的管理员数据
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 动态导入模型
try {
  const { default: sequelize } = await import('./src/server/config/database.js');
  const { default: Administrator } = await import('./src/server/models/Administrator.js');

  console.log('🔍 检查数据库中的管理员数据...');
  
  // 连接数据库
  await sequelize.authenticate();
  console.log('✅ 数据库连接成功');

  // 查询所有管理员
  const admins = await Administrator.findAll({
    attributes: ['id', 'username', 'role', 'is_active', 'created_at']
  });

  console.log('\n📊 管理员列表:');
  console.log('===============');
  
  if (admins.length === 0) {
    console.log('❌ 数据库中没有任何管理员！');
    console.log('\n💡 需要初始化管理员:');
    console.log('curl -X POST http://47.100.1.250:3000/api/admin/init');
  } else {
    admins.forEach((admin, index) => {
      console.log(`${index + 1}. ID: ${admin.id}`);
      console.log(`   用户名: ${admin.username}`);
      console.log(`   角色: ${admin.role}`);
      console.log(`   状态: ${admin.is_active ? '启用' : '禁用'}`);
      console.log(`   创建时间: ${admin.created_at}`);
      console.log('   ---');
    });
  }

  await sequelize.close();
  console.log('\n✅ 检查完成');
  
} catch (error) {
  console.error('❌ 检查失败:', error.message);
  process.exit(1);
}
