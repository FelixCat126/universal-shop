# 备份与恢复（公测运维基线）

## 1. 定时备份

```bash
# 每天 03:00 执行，保留 14 天，并同步到异地目录
0 3 * * * cd /home/app/universal-shop-v1.2.0 && BACKUP_OFFSITE_DIR=/mnt/backup/universal-shop bash scripts/db/backup-prod.sh >> logs/backup.log 2>&1
```

备份内容：
- `shop.sql.gz`：完整 PostgreSQL 数据
- `uploads.tar.gz`：商品图、头像、系统配置图片

## 2. 恢复

恢复到**空库**：

```bash
TARGET_DATABASE_URL=postgres://shop:password@127.0.0.1:5432/shop_restore \
  bash scripts/db/restore-prod.sh database/backups/<timestamp>/shop.sql.gz
```

覆盖已有库（会先做安全备份，再 DROP public schema）：

```bash
ALLOW_DROP=1 TARGET_DATABASE_URL=postgres://shop:password@127.0.0.1:5432/shop_prod \
  bash scripts/db/restore-prod.sh database/backups/<timestamp>/shop.sql.gz
```

## 3. 公测前必须做一次恢复演练

1. 创建临时数据库 `shop_restore`。
2. 用最近一份 `shop.sql.gz` 恢复到临时库。
3. 对比 users / products / orders / partners 等关键表行数。
4. 启动临时实例，验证登录、商品列表、订单详情和 Admin 后台。
5. 记录恢复耗时与结果，未通过不得公测。

## 4. 注意事项

- 备份文件包含敏感业务数据，禁止提交到 Git。
- 异地目录建议加密存储并限制读取权限。
- `ALLOW_DROP=1` 只允许在确认目标库可覆盖时使用。
