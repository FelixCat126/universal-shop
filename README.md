# Universal Shop · 轻量化多端商城

> Vue 3 + Node.js + PostgreSQL 16 全栈电商系统：用户门户 / 合作方门户（批发 + MOQ）/ 管理后台 三端独立 SPA，支持 zh-CN / en-US / th-TH 三语 + 多币种结算。

[![Tests](https://img.shields.io/badge/tests-259%2B-brightgreen)]() [![PostgreSQL](https://img.shields.io/badge/postgres-16-blue)]() [![Vue](https://img.shields.io/badge/vue-3.5-42b883)]() [![Node](https://img.shields.io/badge/node-%E2%89%A518-339933)]()

## 1. 项目结构

```
universal-shop/
├── src/
│   ├── server/             # Express 后端（routes / controllers / models / middlewares）
│   ├── portal/             # 用户门户（Vue 3 + Tailwind）
│   ├── admin/              # 管理后台（Vue 3 + Element Plus）
│   ├── partner/            # 合作方门户（批发）
│   └── utils/              # 跨端工具（汇率/币种）
├── tests/
│   ├── api/                # 接口/单元（Vitest + 真实 PG）
│   ├── integration/        # 跨端 + 并发（Vitest + 真实 PG）
│   └── vue/                # Vue 组件 + Pinia store（happy-dom）
├── scripts/                # 部署 / 数据库 / 钩子脚本
├── compose.prod.pg.yml     # 生产 PostgreSQL Docker Compose
└── docs/                   # 架构 / 业务 / 安全 / PG 迁移 / CHANGELOG
```

## 2. 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Vue 3, Vite, Pinia, vue-i18n, Tailwind CSS, Element Plus |
| 后端 | Node.js ≥ 18, Express 4, Sequelize 6, JWT, Helmet, express-rate-limit |
| 数据库 | **PostgreSQL 16**（Docker Compose 一键起） |
| 测试 | Vitest, Supertest, @vue/test-utils, happy-dom |
| 部署 | PM2 + Nginx + 自签/正签 SSL，阿里云一键脚本 |

## 3. 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动 PostgreSQL（Docker）
npm run db:up

# 3. 初始化业务表 + 种子数据（仅首次）
npm run setup
npm run seed

# 4. 启动 4 个并行开发进程（server / portal / admin / partner）
npm run dev
```

访问：
- 用户门户：<http://localhost:3001/>
- 管理后台：<http://localhost:3002/>
- 合作方门户：<http://localhost:3003/>
- API：<http://localhost:3000/api>

> ⚠️ 本地开发请统一使用 `localhost` 而不是 `127.0.0.1`：前端默认把 API 指向
> `http://localhost:3000/api`，从 `127.0.0.1:3001` 访问页面会产生跨源请求并被
> CORS 拦截（页面白屏）。如果确实需要用 `127.0.0.1` 或局域网 IP 调试，启动后端前设置
> `ALLOWED_ORIGINS=http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003`（逗号分隔）。
>
> 💡 新增前端依赖后若页面出现 `504 Outdated Optimize Dep` 白屏，执行 `npm run clean`
>（会清理 `node_modules/.vite` 预构建缓存）再重启 dev 进程即可。

## 4. 运行测试

```bash
npm run test:api          # 后端接口/单元（约 207 用例，PG 实库）
npm run test:integration  # 并发 / 跨端集成（约 13 用例）
npm run test:vue          # 前端组件 + Pinia（39 用例，happy-dom）
npm run test:all          # 全量
npm run test:coverage     # 带覆盖率
```

测试矩阵全景（2026-10）：

| 类别 | 用例数 | 备注 |
|---|---|---|
| P0 基建 | — | factories / helpers / seedTestBaseline |
| P1 用户面 | 67 | 注册/登录/资料/Catalog/Cart/Address/Order/Points |
| P2 合作方 | 31 | 批发 MOQ + 折扣边界 |
| P3 Admin | 71 | 商品/分类/订单/用户/合作方/管理员/系统配置/统计/导出 |
| P4 跨端 | 18 | 3 角色 × 4 端点权限矩阵 + 10 跨端集成 |
| P5 安全 | 15 | 限流真触发 / CSP・HSTS / AuditLog 三类落库 |
| P6 接口补遗 | 17 | 行政区划/匿名 cart/库存调整/上传鉴权 |
| 边界加固 | 22 | 验证码/共享状态/游客风控/积分上限/累计消费口径 |
| 定价边界 | 9 | 券 scope/分摊/直降精度/金额上限/组合包 |
| 权限矩阵 | 12 | 三角色 × 六资源的黑盒 HTTP 验证 |
| 订单状态机 | 10 | 合法跳转/跳步/回退/终态/无副作用 |
| 零售并发 | 8 | 超卖/幂等键/券核销/库存守恒/积分一致 |
| 游客下单 E2E | 4 | 真实浏览器（移动端 + 桌面端） |
| Vue 单元 | 145 | utils / store / 组件 / i18n 键集一致性 |
| **合计** | **452 + 98 + 145** | API / 集成 / Vue 三套连跑稳定 |

> 测试环境与生产结构一致：`tests/setup/test-setup.js` 在建表后会调用
> `prepareSchema()` 补建自定义索引（如 `uniq_orders_user_client_key`），
> 否则并发幂等等依赖索引的行为在测试中无法被验证。

## 5. 生产部署

### 5.1 打包上传

```bash
./package.sh                             # 产出 universal-shop-v*.tar.gz
scp universal-shop-v*.tar.gz user@host:~
```

### 5.2 服务器一键部署

```bash
ssh user@host
tar -xzf universal-shop-v*.tar.gz
cd universal-shop-v*

# 首次：拷贝 deploy.env.example → .env，配置 DATABASE_URL / JWT_SECRET / INIT_SECRET / ALLOWED_ORIGINS
cp deploy.env.example .env
vi .env

# 启 PG（首次） + 自动迁移 + PM2 重启
npm run deploy:on-server
```

`deploy-on-server.sh` 会：
1. `docker compose -f compose.prod.pg.yml up -d` 启动 PostgreSQL（如未起）
2. `pg_dump` 老库备份（如有）
3. 业务表 sync + 必要 ALTER + 自动建超管（`INIT_SECRET` + `INIT_ADMIN_PASSWORD`）
4. PM2 reload，零停机

### 5.3 环境变量（关键项）

参见 `deploy.env.example`，最重要：

```dotenv
NODE_ENV=production
DATABASE_URL=postgres://shop:STRONG@127.0.0.1:5432/shop_prod
JWT_SECRET=…(>=32 chars, openssl rand -hex 32)…
JWT_ADMIN_SECRET=…
JWT_PARTNER_SECRET=…
INIT_SECRET=…
INIT_ADMIN_PASSWORD=…
ALLOWED_ORIGINS=https://shop.example.com,https://admin.example.com,https://partner.example.com
TRUST_PROXY=1
LOG_DIR=/var/log/universal-shop
```

完整安全配置（Nginx + WAF + helmet 调优）见 `docs/security-and-edge-defense.md`。

## 6. 文档导航

| 文档 | 内容 |
|---|---|
| `docs/architecture.md` | 系统架构、模块设计、API 一览、测试矩阵 |
| `docs/business-features.md` | 业务功能与操作流程详解 |
| `docs/security-and-edge-defense.md` | 安全栈 + Nginx + WAF 部署指南 |
| `docs/postgres-migration-plan.md` | 从 SQLite 切到 PostgreSQL 的完整记录 |
| `docs/CHANGELOG.md` | 版本更新日志 |

## 7. 默认账户

首次部署后用 `INIT_SECRET` 调 `/api/admin/init` 自动创建超级管理员；不预置任何明文账号，避免 P0 弱密码空洞。

## 8. 许可证

MIT License
