#!/usr/bin/env node
/**
 * 生产环境部署后的数据库步骤：
 * - sequelize.sync() 仅创建缺失表，不使用 force
 * - 可选：scripts/db/patches/*.sql 有文件时才执行 ALTER（见 apply-sql-patches.mjs）
 * - 不重置管理员密码、不 DROP 业务表；生产环境跳过含 DROP/重建 的约束自动修复
 * 由 scripts/deploy-aliyun.sh 以 NODE_ENV=production 调用。
 */
import DataSeeder from '../src/server/seeds/index.js'

await DataSeeder.runProductionUpdate()
