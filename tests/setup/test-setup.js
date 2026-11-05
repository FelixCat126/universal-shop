/**
 * 测试入口：在导入任何模块之前必须设置环境变量。
 *
 * 必备：
 *   DATABASE_URL_TEST   测试库连接串（推荐 postgres://shop:shop@127.0.0.1:5432/shop_test）
 *   未设则回退到本地默认；本地用 `npm run db:up` 一键启动 docker PG。
 */

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only-32-chars-long'
process.env.JWT_ADMIN_SECRET = 'test-admin-jwt-secret-key-for-testing-only'
process.env.JWT_PARTNER_SECRET = 'test-partner-jwt-secret-key-for-testing-only'
process.env.CAPTCHA_SECRET = 'test-captcha-secret-key-for-testing-only'
// 验证码答案已移到服务端存储（不再明文放 token），测试需要受控接口读取答案
process.env.ENABLE_CAPTCHA_TEST_API = '1'

// 默认测试库
if (!process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
}
// 并发测试需要较大的连接池（默认 10 在 50 并发时会触发 acquire 超时）
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || '40'
process.env.PG_POOL_ACQUIRE_MS = process.env.PG_POOL_ACQUIRE_MS || '60000'

import crypto from 'node:crypto'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { TestDatabase } from './test-database.js'

/**
 * 每个测试文件用**独立的 PG schema**。
 *
 * 所有文件共用一个库、靠 beforeEach 的 TRUNCATE 隔离，是残留随机失败的根源：
 * 只要有一点异步残留（上个用例 fire-and-forget 的写、下个用例的钩子与上个
 * 用例收尾交叠），就会出现「行被抹掉 / 角色串了 / 表不见了」，而且每次落在
 * 哪个用例上都不一样。独立 schema 之后，隔离由数据库本身保证，与执行顺序无关。
 *
 * 关键：schema 必须在**模型被定义之前**定下来 —— Sequelize 在 define 时就把
 * 表名绑定到 schema 上，之后再改 options 已经晚了。setup 文件先于任何测试
 * 文件求值，正好是那个时机。
 *
 * schema 名带进程号：只清「别的进程」留下的，当前进程自己的不能动。
 */
const TEST_SCHEMA = `t_${process.pid}_${crypto.randomBytes(6).toString('hex')}`

/**
 * supertest 的临时 server 必须**走 IPv6 回环**（或与它绑定的地址族一致）。
 *
 * 背景：supertest 每次 request(app) 都会 listen(0) 一个临时端口。
 * 不指定 host 时 Node 绑的是 **IPv6 通配地址 `::`**，
 * 而 supertest 的客户端连的是 **127.0.0.1（IPv4）**。
 *
 * 在 macOS/BSD 上，**IPv6 通配监听与 IPv4 监听可以共存于同一个端口**：
 * 只要本机另一个进程（IDE、微信、Electron……）先监听了 127.0.0.1:P，
 * 我们的 server 依然能成功绑定 ::P —— 于是客户端连 127.0.0.1:P 时，
 * **应答的是那个进程，不是我们的 app**，我们的 app 压根没收到请求。
 *
 * 实测（本机）：某端口被 ZCode 占用、另一端口被 wechatweb 占用，
 * 测试分别收到 404 / 500 / 426 —— 这些状态码我们的代码里根本不存在。
 *
 * 修法：客户端改连 **[::1]**（IPv6 回环）。
 * IPv6 回环的连接只会匹配 IPv6 socket —— 本机那些 IPv4 监听者（IDE/微信）
 * 抢不走我们的请求；真要抢端口，它们得先占住 IPv6 的同名端口，
 * 那我们的 :: 绑定就会 EADDRINUSE，操作系统会换端口给我们。
 *
 * 若机器没开 IPv6（server 绑成 IPv4），则回退到 127.0.0.1 ——
 * 此时端口在 IPv4 上本来就是独占的，同样安全。
 *
 * 只影响测试（supertest 只在测试里用），不涉及生产代码。
 */
{
  const supertest = (await import('supertest')).default
  const Test = supertest?.Test
  if (Test && !Test.prototype.__shopLoopbackPatched) {
    Test.prototype.serverAddress = function (app, path) {
      if (!app.address()) this._server = app.listen(0)
      const bound = app.address()
      if (!bound) {
        throw new Error('supertest 临时 server 绑定失败')
      }
      const host = bound.family === 'IPv6' ? '[::1]' : '127.0.0.1'
      return `http://${host}:${bound.port}${path}`
    }
    Test.prototype.__shopLoopbackPatched = true
  }
}

/**
 * PROBE：把服务端错误打到 stdout。
 *
 * 测试环境里 logger 是 silent 的（没有 transport），所以接口返回 500 时
 * **看不到原因** —— 只能看到「预期 404 实际 500」这种无信息量的断言失败。
 * 这里临时挂一个 Console transport，把 logger.error 的内容打出来。
 */
if (process.env.PROBE_ERRORS) {
  const winston = (await import('winston')).default
  const { logger } = await import('../../src/server/utils/logger.js')
  logger.silent = false
  logger.add(new winston.transports.Console({ level: 'error' }))
}

/**
 * 表结构的准备放在**模块顶层**（而不是 beforeAll）。
 *
 * 原因：setup 文件先于任何测试文件求值，这里做完建表，
 * 后面所有测试文件就直接用现成的表 —— 不会有「某个文件正在重建表、
 * 把别的文件的表抽走」这种竞态。
 *
 * 原本每个测试文件都在 beforeAll 里重建一次（drop 全部表 + 逐个建表），
 * 问题有三：
 *   1. 慢：70+ 个文件各重建一次全库；
 *   2. 危险：重建 = DROP 全部表。重建的瞬间，别的文件正在读写表，
 *      就会突然拿到 "relation xxx does not exist" —— 表现为随机落在
 *      不同用例上的莫名失败，每次落在哪里都不一样，极难排查；
 *   3. 建表顺序依赖模型注册顺序，而注册顺序取决于各测试文件 import 了谁，
 *      于是「有时建得出来、有时建不出来」。
 *
 * 现在由 TestDatabase.syncModels() 自己判断：指纹（存在磁盘标记文件里，
 * 跨文件/跨进程共享）一致且表都在 → 直接复用；否则才重建，
 * 且重建用 PG 咨询锁串行化（避免多个文件同时重建、互相 DROP 对方的表）。
 * 建表按外键依赖顺序重试。
 */
/**
 * 模块顶层：只把 schema **绑定**到模型上（必须在模型定义之前）。
 *
 * 注意这里**不建 schema、不建表** —— 那些放到 beforeAll 里做。
 * 原因：PG 的 enum 类型名跨 schema 不唯一，而 Sequelize 的 describeTable
 * 按 typname 匹配且不限定 schema —— 若多个 schema 同时存在（收集阶段会把
 * 所有文件的 setup 都求值一遍），describeTable 就会报
 * "more than one row returned by a subquery used as an expression"，
 * prepareSchema() 中断，后续索引/约束都建不出来。
 * 改成测试时才建 → 任一时刻只有一个 schema 带 enum，冲突消失。
 */
{
  // 先把连接串模块加载进来，并在**模型定义之前**指定 schema
  const { default: sequelize } = await import('../../src/server/config/database.js')
  // 模型层：define.schema 决定表建在哪、查询指向哪
  sequelize.options.define.schema = TEST_SCHEMA
  // 查询生成器层：qi.describeTable('users') 这类不带 schema 的调用默认查 public，
  // 这里要跟着走，否则 schemaEnsures 会「表不存在」而中断
  sequelize.dialect.queryGenerator.options.schema = TEST_SCHEMA
  // 连接池的**每条连接**都要切到本文件的 schema。
  // 必须在任何连接被创建之前装上（authenticate() 会建第一条连接）——
  // 否则那条连接的 search_path 是默认的 public，PG 的 enum 类型
  // （CREATE TYPE 不带 schema）就会跑到 public，和表对不上。
  TestDatabase.installSchemaHook(sequelize, TEST_SCHEMA)
  // Sequelize 的 describeTable 有两段跨 schema 的标量子查询
  // （enum 按 typname 匹配、表名按 relname 匹配），多 schema 共存时会报
  // "more than one row returned by a subquery used as an expression"，
  // 导致 prepareSchema() 中断、幂等等唯一索引建不出来 → 大批用例随机失败。
  // 详见 patchDescribeTableQuery 的注释。
  TestDatabase.patchDescribeTableQuery(sequelize)
  // 交给 TestDatabase（模块变量 —— 不能放 process.env，那是进程级的，
  // 下一个文件会覆盖它，导致上一个文件的 afterAll 删掉下一个文件的 schema）
  TestDatabase.setSchema(TEST_SCHEMA)
}
/**
 * 补建生产用的自定义索引/约束（幂等键唯一索引等）。
 *
 * 这些索引由 schemaEnsures.js 在**生产启动链**里创建，而测试环境
 * NODE_ENV=test 不执行启动链 —— 结果测试库缺少
 * uniq_orders_user_client_key 等唯一索引，
 * 并发幂等/防重行为在测试中无法被验证（表现为"幂等键并发创建多单"）。
 * 这里显式调用，让测试环境与生产保持一致。
 */
console.log('✅ 测试环境初始化完成')

/**
 * 每个文件的表结构准备放在 **beforeAll**（测试时），而不是模块顶层。
 *
 * 原因：PG 的 enum 类型是「不带 schema」创建的（CREATE TYPE "enum_xxx"），
 * 落到哪个 schema 取决于连接的 search_path。如果在收集阶段就把所有文件的
 * schema 都建出来，几十个 schema 同时带同名 enum，
 * Sequelize 的 describeTable（其子查询按 typname 匹配且不限定 schema）就会报
 * "more than one row returned by a subquery used as an expression"，
 * prepareSchema() 中断，后续索引/约束全建不出来。
 * 放到测试时才建 → 任一时刻只有一个 schema 带 enum，冲突消失。
 */
beforeAll(async () => {
  console.log('🧪 初始化测试环境（PostgreSQL）...')
  await TestDatabase.initialize()
  await TestDatabase.syncModels()
  /**
   * 补建生产用的自定义索引/约束（幂等键唯一索引等）。
   *
   * 这些索引由 schemaEnsures.js 在**生产启动链**里创建，而测试环境
   * NODE_ENV=test 不执行启动链 —— 结果测试库缺少
   * uniq_orders_user_client_key 等唯一索引，
   * 并发幂等/防重行为在测试中无法被验证（表现为"幂等键并发创建多单"）。
   * 这里显式调用，让测试环境与生产保持一致。
   */
  try {
    const { prepareSchema } = await import('../../src/server/utils/schemaEnsures.js')
    await prepareSchema()
  } catch (err) {
    console.warn('⚠️ 测试环境 schema 补充失败（部分并发用例可能失真）:', err?.message)
  }
  console.log('✅ 测试环境初始化完成')
})

afterAll(async () => {
  if (process.env.PROBE_POOL) {
    const samples = globalThis.__poolSamples || []
    const maxUsed = samples.reduce((m, s) => Math.max(m, s.used || 0), 0)
    const minAvail = samples.reduce((m, s) => Math.min(m, s.avail ?? 999), 999)
    console.log('PROBE_POOL_SUMMARY samples=', samples.length,
      'maxUsed=', maxUsed, 'minAvail=', minAvail,
      'tail=', JSON.stringify(samples.slice(-5)))
  }
  console.log('🧹 清理测试环境...')
  await TestDatabase.cleanup()
  console.log('✅ 测试环境清理完成')
})

beforeEach(async () => {
  // PROBE: 连接池水位（不额外建连接，读 Sequelize 连接池自身状态）
  if (process.env.PROBE_POOL) {
    const pool = TestDatabase.getSequelize()?.connectionManager?.pool
    if (pool) {
      globalThis.__poolSamples = (globalThis.__poolSamples || [])
      globalThis.__poolSamples.push({ used: pool.used, avail: pool.available, size: pool.size })
    }
  }
  await TestDatabase.clearAllData()

  /**
   * 下面这些都是**进程内**的共享状态（内存 store / LRU 缓存）。
   *
   * Vitest 每个测试文件有独立的模块注册表，但同一个 worker 进程里
   * 这些状态仍可能跨文件存活（取决于是否被 isolate 复位）。
   * 之前只有个别测试文件自己重置它们，其余文件直接继承了上一个文件的
   * 计数/缓存，表现为随机落在不同用例上的断言失败。
   *
   * 统一在全局 beforeEach 里清一遍，所有文件口径一致。
   */
  try {
    // authMiddleware 5s 用户状态 LRU 缓存
    // 否则 PG TRUNCATE RESTART IDENTITY 后新建用户会复用旧 id，命中陈旧 cache
    const { _clearAuthCacheForTests } = await import('../../src/server/middlewares/authMiddleware.js')
    _clearAuthCacheForTests()
  } catch (_) { /* 早于 module 加载时忽略 */ }
  try {
    // 管理员状态缓存（adminAuthMiddleware）
    const { _clearAdminAuthCacheForTests } = await import('../../src/server/middlewares/adminAuthMiddleware.js')
    _clearAdminAuthCacheForTests()
  } catch (_) { /* 早于 module 加载时忽略 */ }
  try {
    // 游客下单保护计数（按手机号 / IP 维度）
    const { _resetGuestOrderProtectionForTests } = await import('../../src/server/middlewares/guestOrderGuard.js')
    await _resetGuestOrderProtectionForTests()
  } catch (_) { /* 早于 module 加载时忽略 */ }
  try {
    // 登录失败计数（超过阈值会强制验证码）
    const { _resetLoginGuardForTests } = await import('../../src/server/middlewares/loginGuard.js')
    await _resetLoginGuardForTests()
  } catch (_) { /* 早于 module 加载时忽略 */ }
  try {
    // GET 响应缓存（URL 为键；换库后旧响应必须失效）
    const { clearResponseCache } = await import('../../src/server/utils/responseCache.js')
    await clearResponseCache()
  } catch (_) { /* 早于 module 加载时忽略 */ }
})
