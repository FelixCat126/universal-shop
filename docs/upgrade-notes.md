# 升级前必读：哪些地方依赖了库的内部实现

`package.json` 里这几个包**锁死了精确版本**（不带 `^`）：

| 包 | 版本 | 为什么锁 |
|---|---|---|
| sequelize | 6.37.8 | 我们 patch 了它生成的 SQL（见下） |
| express | 4.22.3 | 我们直接读它的路由表结构 |
| vitest | 1.6.1 | 覆盖率门槛的**格式**在 1.x 与 2.x/3.x 之间不兼容 |
| pg | 8.21.0 | `pg_type` / `pg_statio_all_tables` 是库级目录，跨 schema 同名会撞 |
| exceljs | 4.4.0 | 流式导出（WorkbookWriter）依赖其行为 |
| multer | 1.4.5-lts.2 | 上传错误码（`LIMIT_FILE_SIZE`）被 errorHandler 判定 |

其它包保持 `^` 常规范围。

---

## 升级前必须逐条核对的地方

### 1. Sequelize 的 describeTable SQL（最脆的一处）

**位置**：`tests/setup/test-database.js` → `patchDescribeTableQuery()`

Sequelize 6 的 postgres `describeTableQuery` 里有两段**标量**子查询，是跨 schema 的：

```sql
(SELECT array_agg(e.enumlabel) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_enum e ...
  WHERE t.typname = c.udt_name)                      -- enum 按 typname 匹配
(SELECT pgd.description FROM pg_catalog.pg_statio_all_tables AS st ... 
  WHERE ... AND c.table_name = st.relname)            -- 表名按 relname 匹配
```

`pg_type` / `pg_statio_all_tables` 都是**库级**目录，`typname`/`relname` 跨 schema 不唯一。
只要存在第二个 schema 也有同名 enum 或同名表，这两段就匹配到多行 →
`more than one row returned by a subquery used as an expression` →
`prepareSchema()` 中断 → 幂等等唯一索引建不出来 → **大批用例随机失败**。

我们的补丁把两段都限定到 `c.table_schema`（见该函数注释）。

> **升级 Sequelize 时**：如果它改了这段 SQL 的文本，补丁会**故意抛错**
> （`describeTableQuery 补丁失效：Sequelize 的 SQL 结构与预期不符`）——
> 这是有意的 fail-loud，比"静默失效 → 随机失败"好。
> 届时按新的 SQL 文本更新补丁里的两个常量即可。

### 2. Sequelize 的返回值形状（两处，容易踩）

- `Model.update()` → 返回 **`[影响行数]`**（数组）
- `Model.destroy()` → 返回 **数字**
- `sequelize.query(sql)` → 返回 `[rows, metadata]`
- `sequelize.query(sql, { type: QueryTypes.SELECT })` → 返回 **行数组本身**（没有 metadata 层！）

最后一处特别容易搞错：同一个 `query()`，传不传 `type` 结果形状**不一样**。
本仓库里已按各自形状写对了（`scripts/db/apply-sql-patches.mjs` 用无 type 的形式，
测试基建里用带 type 的形式）。

### 3. Express 的路由表结构

**位置**：`src/server/utils/routeInventory.js`

我们直接读 `app._router.stack`，并从 `layer.regexp.source` 还原挂载前缀
（`^\/api\/products\/?(?=\/|$)` → `/api/products`）。

> **升级 Express 5 时**：路由表结构和 `layer.regexp` 都会变，
> `collectRoutes()` 与 `prefixFromRegexp()` 需要重写。
> 契约测试（`tests/api/frontendContract.test.js`）与 OpenAPI 生成会立刻暴露问题。

### 4. Vitest 的覆盖率门槛格式

**位置**：`vitest.config.js` → `coverage.thresholds`

Vitest **1.x** 读的是**顶层数字键** + 带 `**` 的 glob：

```js
thresholds: {
  statements: 83, branches: 73, functions: 84, lines: 83,   // ← 全局门槛
  'src/server/controllers/**': { statements: 75, ... }      // ← 分目录门槛
}
```

写成 `{ global: {...} }` **不会报错，但完全不生效** —— Vitest 1.x 会把 `global`
当成一个 glob 模式，匹配不到任何文件 → 该分组为空 → 直接跳过。
（这个坑真的踩过：门禁空转了很久，branches 64% < 写的 70% 都照样绿。）

> **升级 Vitest 2.x/3.x 时**：门槛格式有变化（2.x 起 `global` 才是显式写法）。
> 升级后务必验证门禁**真的会红**：把某个阈值临时调到当前值以下跑一次，
> 确认报 `ERROR: Coverage for ... does not meet ...`。
> 仓库里有守卫测试 `tests/api/coverageGate.test.js`（检查配置格式），但它**不能**
> 验证 Vitest 本身的行为，所以升级后仍需手工验证一次。

### 5. PG 的跨 schema 同名对象

PG 里 `pg_type.typname`、`pg_statio_all_tables.relname` **跨 schema 不唯一**。
测试基建用「每个测试文件一个独立 schema」来隔离，
因此**任何时候都不要在同一个库里长期留两个同名 schema**（比如手工建库时）。

### 6. macOS 上 IPv6 通配与 IPv4 监听可共存同一端口

**位置**：`tests/setup/test-setup.js`（supertest 的 serverAddress patch）

supertest 默认让 server 监听 IPv6 通配 `::`，客户端却连 `127.0.0.1`（IPv4）。
macOS/BSD 上这两种监听**能共存于同一端口** —— 本机别的进程（IDE、微信等）
先占住那个 IPv4 端口时，测试请求会被**它们**应答，我们的 app 收不到。

补丁让客户端改连 `[::1]`（IPv6 回环），IPv4 监听者抢不走。
> 升级 supertest 时要重新确认这个补丁（它挂在 `Test.prototype.serverAddress` 上）。

---

## 升级后的验证清单

```bash
npm ci                                   # 装上锁定版本
npm run test:all                         # API + 集成 + Vue
npm run test:coverage                    # 覆盖率门禁（确认真的会红）
npm run bench:api -- --slo               # 性能 SLO
npx playwright test                      # 真实浏览器 E2E
node scripts/check-data-invariants.mjs   # 数据不变量（连测试库）
```
