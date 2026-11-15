# 备份与恢复（公测运维基线）

> 本文档按**生产实测**整理（2026-11-15 在生产做过一次完整的隔离恢复演练）。
> 与实际不符的地方以本文件为准，代码为准。

## 1. 定时备份

生产用 **systemd timer**，不是 cron：

```bash
# 每天 02:40 执行（避开整点，也避开 cider-backup 的 02:20）
# 服务器重启后会补一次错过的备份（Persistent=true）
systemctl list-timers universal-shop-backup.timer
systemctl start universal-shop-backup.service   # 手动立刻跑一次
```

单元文件：`/etc/systemd/system/universal-shop-backup.{timer,service}`

备份内容（目录 `database/backups/<时间戳>/`）：
- `shop.sql.gz`：**pg_dump 16.14** 的 plain SQL 完整备份（与服务端同版本 —— 备份走
  `docker exec universal-shop-pg pg_dump`，不依赖宿主机装 postgresql-client）
- `uploads.tar.gz`：商品图、头像、系统配置图片
- `manifest.txt`：时间戳、大小、PG 模式、表数量

保留 **14 天**（`BACKUP_RETENTION_DAYS` 可覆盖）。

异地副本：`BACKUP_OFFSITE_DIR` 环境变量可把备份复制到异机目录。
⚠️ **当前生产未配置异地副本** —— 备份只在本机 `database/backups/` 下，
整机或云盘故障时备份会一起丢。公测前建议至少配置一份异地/对象存储副本。

## 2. 恢复

恢复到**空库**：

```bash
TARGET_DATABASE_URL=postgres://shop:password@127.0.0.1:5432/shop_restore \
  bash scripts/db/restore-prod.sh database/backups/<timestamp>/shop.sql.gz
```

恢复脚本默认会检查目标库 `public` schema 是否为空，非空则拒绝（防止误覆盖）。

覆盖已有库（会先做安全备份，再 DROP public schema）：

```bash
ALLOW_DROP=1 TARGET_DATABASE_URL=postgres://shop:password@127.0.0.1:5432/shop_prod \
  bash scripts/db/restore-prod.sh database/backups/<timestamp>/shop.sql.gz
```

## 3. 恢复演练（一条命令，别手工做）

```bash
# 演练最新一份备份：建临时库 → 真实恢复 → 逐表比对 → 删临时库
cd /home/app/universal-shop-v1.2.0
export PG_CONTAINER=universal-shop-pg
bash scripts/db/restore-drill.sh

# 演练指定备份
bash scripts/db/restore-drill.sh database/backups/20261115-024148
```

它会：
1. 校验备份文件 gzip 完整性（损坏的备份在**恢复之前**就被挡住）
2. 建临时库 `restore_drill_<时间戳>`
3. 用**生产恢复脚本** `restore-prod.sh` 恢复（演练的就是真实链路，不另写一套）
4. 逐表比对：**备份快照(dump) vs 恢复库**（对不上 = 恢复不完整 = 判失败），
   同时打印生产当前行数用于观察时序差
5. 无论成败都删除临时库

退出码 0 = 演练通过（备份可用）；非 0 = 这份备份不可信。

> 判定基准是「备份快照 vs 恢复库」而不是「恢复库 vs 生产库」：
> 备份是生产的某个时间点的快照，之后生产继续写入属于正常时序差，
> 拿它判失败会永远误报。

**生产实测（2026-11-15）**：演练 `20261115-024148` 这份备份，27 张表全部与备份快照
一致，仅 `system_configs` 因备份之后新增了一条配置而有 1 行时序差 → 演练通过。
同一份备份**故意截断**后演练 → 判失败（退出码 5），临时库照常清理。

## 4. 无 pg_dump 时的兜底（本地 / CI / 应急）

生产不需要用这一套；它在**没有 pg_dump 客户端也没有 PG 容器**的环境里才有用。

```bash
# 备份（只备数据，结构由迁移管理；不含 pg_dump / docker 依赖）
node scripts/backup-db.mjs --out /tmp/bk

# 恢复（会先 TRUNCATE 目标表）
node scripts/restore-db.mjs --from /tmp/bk/data-<ts>.tar.gz
```

安全护栏：
- `restore-db.mjs` 默认**拒绝**对非测试/演练库执行（库名需含 test/dev/drill/staging/local/tmp），
  确认无误后加 `--allow-prod` 才放行
- 备份侧若 schema 不存在或一张表都没备到，**直接失败退出**，不会留下"看起来成功的空备份"
- 恢复侧若备份里 0 张表，**拒绝恢复**（否则会把库清成空）

往返验证：`tests/api/backupRestore.test.js`（备份 → 全表清空 → 恢复 → 逐表行数与字段内容一致）。
该用例做过反向验证：注入"备份漏软删行""恢复丢 deleted_at""恢复字段串位"各一次，三条断言都会红。

## 5. 注意事项

- 备份文件包含敏感业务数据，禁止提交到 Git。
- 异地目录建议加密存储并限制读取权限。
- `ALLOW_DROP=1` 只允许在确认目标库可覆盖时使用。
- 生产恢复**只走** `scripts/db/restore-prod.sh`；`scripts/restore-db.mjs` 是兜底，不是生产路径。
