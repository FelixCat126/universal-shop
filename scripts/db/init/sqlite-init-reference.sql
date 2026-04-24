-- =============================================================================
-- Universal Shop · SQLite 数据库初始化参考
-- 方言: SQLite 3（与 src/server/config/database.js 一致）
--
-- 【推荐方式】不要在生产环境手工执行本文件全量 DDL。
--   首次 / 升级部署请使用 Node 脚本（会 Sequelize sync + 执行 patches）：
--     NODE_ENV=production node scripts/production-deploy-setup.mjs
--   或完整种子（仅本地/空库）：node src/server/seeds/index.js
--
-- 【本文件用途】
--   1) 运维查阅：补丁登记表结构、历史增量 ALTER 与 patches 目录对应关系
--   2) 离线应急：在「表已由应用创建」的前提下，可用 sqlite3 手工补列（易与 ORM 不同步，慎用）
--
-- 【与 scripts/db/patches 的关系】
--   部署时由 apply-sql-patches.mjs 按文件名排序执行，并写入 _sql_patches_applied。
--   下方「历史增量」仅为文档镜像；新增列请优先增加 018_xxx.sql，再视需要更新本节注释。
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 补丁执行登记（与 scripts/db/apply-sql-patches.mjs 一致，勿改列语义）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _sql_patches_applied (
  name TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 历史增量 DDL 镜像（对应 scripts/db/patches/；新库通常已由 Sequelize 模型含这些列，
-- 再执行会报 duplicate column，属正常，应以补丁表是否已记录为准）
--
-- 016_products_deleted_at.sql
--   ALTER TABLE products ADD COLUMN deleted_at DATETIME;
--
-- 017_users_avatar_url.sql
--   ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512);
-- -----------------------------------------------------------------------------

-- 业务表（users、products、orders 等）由 Sequelize 模型在首次 sync 时创建，
-- 完整字段定义以 src/server/models/*.js 为唯一事实来源（Single Source of Truth）。
