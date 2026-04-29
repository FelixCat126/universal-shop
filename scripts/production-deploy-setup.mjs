#!/usr/bin/env node
/**
 * 生产环境部署后的数据库步骤：
 * - sequelize.sync() 仅创建缺失表，不使用 force
 * - 可选：scripts/db/patches/*.sql —— 详见该目录（016+/018+）；有文件时对「已有 SQLite 库」在 sync 前先补 DDL/回填（apply-sql-patches.mjs）
 * - 增量迁移：`ensureProductCategoriesMigrate`（默认四类类目、回填 products.category_id 空值）
 * - 单独跑分类迁移：`NODE_ENV=production node scripts/db/migrate-product-categories-production.mjs`
 * - 服务端启动时（app.js）另有 ensure* 与积分表模型注册，与本流程互补、幂等
 * - 不重置管理员密码、不 DROP 业务表；生产环境跳过含 DROP/重建 的约束自动修复
 * 由 scripts/deploy-aliyun.sh / deploy-on-server.sh 以 NODE_ENV=production 调用。
 */
import DataSeeder from '../src/server/seeds/index.js'

await DataSeeder.runProductionUpdate()
