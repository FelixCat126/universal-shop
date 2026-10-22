#!/usr/bin/env node
/**
 * 生产环境部署后的数据库步骤（带 PG advisory lock 防多实例并发迁移）：
 * - sequelize.sync() 仅创建缺失表，不使用 force
 * - schema 准备（补列/补索引/补配置，幂等）→ 必须在 seeder 之前
 * - 增量迁移：ensureProductCategoriesMigrate
 * - 不重置管理员密码、不 DROP 业务表
 *
 * 顺序说明：seeder（DataSeeder.runProductionUpdate）会查询 token_version 等新增列，
 * 而这些列由 prepareSchema() 创建。若不先跑 prepareSchema，seeder 会因
 * "column does not exist" 抛错，导致部署中断且服务停机。
 */
import 'dotenv/config'
import DataSeeder from '../src/server/seeds/index.js'
import sequelize from '../src/server/config/database.js'
import { prepareSchema } from '../src/server/utils/schemaEnsures.js'

const LOCK_ID = 862427113

await sequelize.authenticate()
await sequelize.query('SELECT pg_advisory_lock(:id)', { replacements: { id: LOCK_ID } })
try {
  // 先建缺失表（after_sales 等），再补列/索引/配置，最后跑 seeder
  await sequelize.sync({ alter: false })
  await prepareSchema()
  await DataSeeder.runProductionUpdate()
} finally {
  await sequelize.query('SELECT pg_advisory_unlock(:id)', { replacements: { id: LOCK_ID } }).catch(() => {})
  await sequelize.close().catch(() => {})
}
