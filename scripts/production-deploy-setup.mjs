#!/usr/bin/env node
/**
 * 生产环境部署后的数据库步骤（带 PG advisory lock 防多实例并发迁移）：
 * - sequelize.sync() 仅创建缺失表，不使用 force
 * - 可选：scripts/db/patches/*.sql
 * - 增量迁移：ensureProductCategoriesMigrate
 * - 不重置管理员密码、不 DROP 业务表
 */
import 'dotenv/config'
import DataSeeder from '../src/server/seeds/index.js'
import sequelize from '../src/server/config/database.js'

const LOCK_ID = 862427113

await sequelize.authenticate()
await sequelize.query('SELECT pg_advisory_lock(:id)', { replacements: { id: LOCK_ID } })
try {
  await DataSeeder.runProductionUpdate()
} finally {
  await sequelize.query('SELECT pg_advisory_unlock(:id)', { replacements: { id: LOCK_ID } }).catch(() => {})
  await sequelize.close().catch(() => {})
}
