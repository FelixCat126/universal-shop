#!/usr/bin/env node
/**
 * 单独执行「商品分类」相关增量迁移（生产安全、幂等，可重复执行）。
 *
 * 行为与 `ensureProductCategoriesMigrate` 一致：
 * - 确保存在 `product_categories` 表与默认四类（仅不存在时插入）
 * - 若无 `products.category_id` 列则添加
 * - 仅填充 `category_id IS NULL` 的行的首类默认值，不改已有赋值
 *
 * 典型用法（升级与标准部署任选其一即可，二者重复调用也安全）：
 *   ① 已通过 `NODE_ENV=production node scripts/production-deploy-setup.mjs` 则不须再跑本条（该流程已内含本迁移）。
 *   ② 需在不停机前先跑库脚本时：
 *      NODE_ENV=production node scripts/db/migrate-product-categories-production.mjs
 */
import 'dotenv/config'
import sequelize from '../../src/server/config/database.js'
import { ensureProductCategoriesMigrate } from '../../src/server/utils/ensureProductCategoriesMigrate.js'

async function main () {
  console.log('🔧 [migrate-product-categories] 增量迁移启动（不回滚业务数据）…')
  await sequelize.authenticate()
  console.log('✅ 数据库连接正常')
  await ensureProductCategoriesMigrate()
  console.log('✅ [migrate-product-categories] 完成')
  await sequelize.close()
}

main().catch((err) => {
  console.error('❌ [migrate-product-categories] 失败:', err.message)
  sequelize.close().finally(() => process.exit(1))
})
