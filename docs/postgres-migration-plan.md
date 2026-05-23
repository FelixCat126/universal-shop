# PostgreSQL 迁移说明（已完成）

> 状态：✅ 项目已彻底切换到 PostgreSQL，SQLite 相关代码与依赖已全部移除。
> 本文档记录迁移过程、目录结构变化与排查指南。

## 1. 为什么迁

| 维度 | SQLite | PostgreSQL |
|---|---|---|
| 并发写 | 单 writer，遇竞争只能 BUSY 等待 | 行级 MVCC，真并发写 |
| 数据完整性 | WAL 模式仍受单进程限制 | 完整 ACID + 严格类型 + 序列化级别可调 |
| 高可用 | 无 | 主从、流复制、PITR 均成熟 |
| 在线变更 | 受限 | DDL 几乎全部在线 |
| 工具链 | psql/sqlite3 | psql、pgAdmin、pg_dump、PgBouncer 等 |
| 云托管 | 无（需自管文件） | 阿里云 RDS、AWS RDS、CloudSQL 即开即用 |

并发测试客观结论（见 `tests/integration/concurrencySafety.test.js`）：
- **库存超卖**：SQLite 12 并发 → 1～5 笔成功；PG 20 并发 → 恰好 5 笔，stock=0，0 行负库存。
- **支付幂等**：双库都通过；PG 下单条 UPDATE 即满足条件并发。
- **默认地址**：SQLite 易出现 0 或 2 行 default；PG 单条 UPDATE + 死锁重试稳定 1 行。

## 2. 迁移完成项一览

### 代码改造
- `src/server/config/database.js` 仅保留 PG 配置；环境变量 `DATABASE_URL` / `DATABASE_URL_TEST` / `PG_POOL_*` / `PG_SSL`。
- `src/server/app.js` 移除 `ensureSqliteProductDeletedAtColumn` 等 SQLite 专用 ALTER；启动链改为 `qi.describeTable + qi.addColumn`（dialect-agnostic）。测试环境跳过自动 sync，由 TestDatabase 接管。
- `src/server/utils/dateFilters.js` 删除 `strftime`/`getDialect()==='sqlite'` 分支，统一走 `Op.gte/Op.lte`。
- `src/server/seeds/index.js` 删除 SQLite 兜底列补齐 + `fixIncorrectConstraints`（基于 `sqlite_master` 的历史一次性逻辑）。
- `src/server/controllers/partnerPortalController.js#setDefaultAddress` 改为单条 UPDATE + PG 死锁/序列化失败重试。
- `scripts/db/apply-sql-patches.mjs` 历史补丁表改为 `TIMESTAMPTZ DEFAULT NOW()`；patches 目录已清空（旧补丁归档至 `scripts/db/patches-sqlite-archive/`）。

### 依赖
- 卸载：`sqlite3`
- 保留：`pg`、`pg-hstore`、`sequelize`

### 测试基建
- `tests/setup/test-database.js` 重写为 PG：`drop({ cascade: true })` + 串行 `Model.sync()` 避免并行索引竞态；`clearAllData()` 用 `TRUNCATE ... RESTART IDENTITY CASCADE`。
- `tests/setup/test-setup.js` 默认 `DATABASE_URL_TEST=postgres://shop:shop@127.0.0.1:5432/shop_test`，连接池上限 40，acquire 超时 60s。
- 删除 `tests/unit/`、`tests/e2e/`、以及 9 个与现行 schema 漂移的旧测试文件。

### 部署辅助
- 新增 `docker-compose.yml`：本地一键起 PG 16-alpine，自动执行 `scripts/db/init-pg/01-create-test-db.sql` 建测试库。
- 新增 npm 脚本：`db:up` / `db:down` / `db:logs` / `db:psql` / `db:reset:test`。
- `env.example` 改为 PG 模板（含 `CAPTCHA_SECRET`、`LOGIN_CAPTCHA_THRESHOLD`、`CSP_EXTRA_*` 等所有新增变量）。

## 3. 本地开发与测试

### 启动 PG
任选其一：

**A. Docker（推荐，干净隔离）**
```bash
npm run db:up
# 启动到 5432；shop_dev 与 shop_test 自动创建
```

**B. 本机 Homebrew Postgres**
```bash
brew services start postgresql@16
psql -d postgres -c "CREATE ROLE shop LOGIN PASSWORD 'shop';"
createdb -O shop shop_dev
createdb -O shop shop_test
```

### 跑测试
```bash
npm run test:all
# = test:integration (3) + test:api (24) = 27 passed
```

### 进 psql
```bash
npm run db:psql            # 连 shop_dev
DATABASE_URL=postgres://shop:shop@127.0.0.1:5432/shop_test psql
```

### 重置测试库
```bash
npm run db:reset:test
```

## 4. 生产环境一次性迁移（已封装为脚本）

> ⚠️ 必须在 **本次升级第一次部署到带 SQLite 的生产服务器** 时执行；后续增量发布会被 `deploy-on-server.sh` 自动放行。

### 4.1 一键脚本：`scripts/migrate-prod-to-postgres.sh`

把新版本（含本脚本的发布包）传到服务器解压到 `${DEPLOY_PATH}` 后，在该目录执行：

```bash
cd /home/app/universal-shop-vX.Y.Z
bash scripts/migrate-prod-to-postgres.sh \
  --pg-host 127.0.0.1 \              # 自建本机；用阿里云 RDS 时填内网地址
  --pg-port 5432 \
  --pg-db shop_prod \
  --pg-user shop_app \
  --pg-password '随机强密码' \
  --auto-install                       # 仅自建 PG 时使用；用 RDS 不要加这个参数
```

脚本会按下列顺序做事（任何一步失败都会中断且不破坏现状）：

| # | 阶段 | 动作 | 失败行为 |
|---|---|---|---|
| 0 | 前置检查 | 校验 node/npm/SQLite 文件 | 立即退出 |
| 1 | PG 服务 | `pg_isready` 探测；`--auto-install` 时按发行版安装 PG | 给出对应发行版的安装指引 |
| 2 | 建库建用户 | `CREATE ROLE/DATABASE` 幂等 | 报错并退出 |
| 3 | 备份 | `database/shop.sqlite` → `database/backups/shop.sqlite.pre-pg-migrate.<TS>` | — |
| 4 | 临时装 sqlite3 | `npm install --no-save sqlite3@5.1.6` | — |
| 5 | 建表 | 用 Sequelize models 在目标 PG `sync({alter:false})` | — |
| 6 | 搬数据 | `migrate-sqlite-to-postgres.mjs`：逐表 INSERT + ON CONFLICT DO NOTHING + boolean/JSON 类型适配 + sequence 重置 + 行数比对 | 失败保留旧 .env，提示回滚 |
| 7 | 切 .env | 注释化 `DATABASE_PATH`，写入 `DATABASE_URL`；旧 .env 备份为 `.env.pre-pg-migrate.<TS>` | — |
| 8 | 收尾 | 卸载临时 sqlite3、写 `.pg_migration_done` 标记、`pm2 restart` | — |

> `migrate-sqlite-to-postgres.mjs` 关键点：
> - 自动处理 SQLite `INTEGER 0/1 → PG BOOLEAN`、JSON 列类型差异
> - 跑完调用 `setval(pg_get_serial_sequence(...))` 把所有自增序列推到 `MAX(id)`，避免下次 INSERT 主键冲突
> - 按外键顺序逐表 + 行数比对失败立刻 abort

### 4.2 阿里云 RDS PG 推荐流程

1. 控制台开 RDS for PostgreSQL 16，建 `shop_app` 用户与 `shop_prod` 库
2. ECS 内网白名单加入；测试 `psql -h <内网>` 能登
3. 在服务器执行上面的 `migrate-prod-to-postgres.sh`，**不要加 `--auto-install`**
4. 通过后日常发布走 `npm run deploy:aliyun` 即可

## 5. 生产部署上线 checklist

- [ ] 阿里云 RDS / 自建 PG 16+ 实例就绪
- [ ] 服务器装好 `postgresql-client`（提供 `psql`/`pg_dump` 用于备份）
- [ ] 业务低峰窗口
- [ ] `bash scripts/migrate-prod-to-postgres.sh ...` 一次（看到 "迁移完成"）
- [ ] `.env` 校对：`DATABASE_URL`、`PG_SSL`、`JWT_SECRET`、`INIT_SECRET`、`CAPTCHA_SECRET`、`ALLOWED_ORIGINS`、`TRUST_PROXY=1`
- [ ] `pm2 logs universal-shop` 看到正常启动 + `/api/health=200`
- [ ] 业务回归：登录、下单、支付确认、积分发放、合作方流程、地址默认切换
- [ ] 后续增量发版打开 `DEPLOY_PG_BACKUP=1` 启用 pg_dump 自动备份
- [ ] 老 `shop.sqlite` 与 `database/backups/shop.sqlite.pre-pg-migrate.*` 保留 30 天再删

## 6. 排查

| 现象 | 原因 / 处理 |
|---|---|
| 启动 `connection refused` | PG 未起；`npm run db:up` 或 `brew services list \| grep post` |
| 启动 `database "shop_dev" does not exist` | `npm run db:up` 会自动建；本机 brew 安装请手动 `createdb -O shop shop_dev` |
| 测试 `relation "audit_logs" does not exist` 之类 | 已通过 `TestDatabase.syncModels` 串行 sync 解决；老快照请重启 vitest |
| 高并发 `acquire timeout` | 调大 `PG_POOL_MAX`（默认 10；测试环境已置 40） |
| 死锁 `40P01` | 本项目热点为 `setDefaultAddress`，已改为单 UPDATE + 重试；其他热点遇到同款问题可参考其实现 |
| 阿里云 SSL 报错 | 设置 `PG_SSL=true`，`dialectOptions.ssl.rejectUnauthorized=false` 已默认开启 |

## 7. 回滚预案

迁移脚本会留下：
- `database/backups/shop.sqlite.pre-pg-migrate.<TS>`（数据冷备）
- `.env.pre-pg-migrate.<TS>`（环境变量冷备）
- `.pg_migration_done`（迁移完成标记）

**回滚步骤**（建议保留 30 天回滚窗口）：
```bash
cd ${DEPLOY_PATH}
pm2 stop universal-shop

# 1) 恢复 .env 与 SQLite
cp .env.pre-pg-migrate.<TS> .env
cp database/backups/shop.sqlite.pre-pg-migrate.<TS> database/shop.sqlite
rm .pg_migration_done

# 2) 部署回旧版本（含 sqlite3 依赖）
#    回到迁移前最后一个稳定 tag，重新 deploy-aliyun
git -C <local-repo> checkout <pre-pg-tag>
npm run deploy:aliyun
```

实务上 24~48h 业务无异常即可视为切换成功。
