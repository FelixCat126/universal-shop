# 已归档的 SQLite 历史补丁

这些 `.sql` 文件是项目早期使用 SQLite 时累积的列补齐 / 表创建补丁。
2026-05 起项目迁移到 PostgreSQL 后，以下事实使它们不再需要执行：

1. 全新 PG 数据库由 `sequelize.sync()` 从最新模型直接创建，所有列都齐全。
2. 既有 SQLite 数据通过 `npm run migrate:sqlite-to-pg` 一次性迁移到 PG，
   迁移脚本会读源库结构并按目标库（已有完整列）写入。

如未来需要在生产 PG 上做新的数据库改动，请使用：
- `scripts/db/patches/` 目录（请改写为 PG 兼容 SQL）
- 或 Sequelize migrations（推荐，按 Umzug 约定）

保留本目录仅供考古/排查历史问题；切勿将这些文件复制回 `patches/` 目录。
