#!/usr/bin/env node

/**
 * 接口性能基准（回归哨兵）
 *
 * 目的：防止某个 PR 把关键接口悄悄改慢 5 倍 —— 单测测不出来，
 * 线上用户才会发现。这里对固定规模的数据集打一遍关键接口，
 * 记录 p50/p95，与基线文件（scripts/bench-baseline.json）比较，
 * 超过容忍倍数就**退出码非 0**（CI 可据此拦截）。
 *
 * 用法：
 *   npm run bench:api                 # 与基线比较，退不回退就非 0 退出
 *   npm run bench:api -- --update     # 把当前结果写成新基线
 *   npm run bench:api -- --json       # 只输出 JSON
 *
 * 基线是**机器相关**的（CPU/磁盘差异），所以默认容忍倍数给得比较宽
 * （1.5×），只拦「明显退化」。CI 上机器不同也不至于天天红。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_FILE = path.join(__dirname, 'bench-baseline.json')

/** 退化容忍倍数（p95 超过基线这么多倍就判回归） */
const REGRESSION_RATIO = Number(process.env.BENCH_REGRESSION_RATIO || 1.5)
/** 数据规模：商品数 / 用户数 / 订单数 */
const SIZE = {
  products: Number(process.env.BENCH_PRODUCTS || 300),
  users: Number(process.env.BENCH_USERS || 200),
  orders: Number(process.env.BENCH_ORDERS || 300)
}

const args = process.argv.slice(2)
const update = args.includes('--update')
const jsonOnly = args.includes('--json')

process.env.NODE_ENV = process.env.NODE_ENV || 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'bench-jwt-secret-key-at-least-32-chars-long'
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET || 'bench-admin-secret-key-at-least-32-chars'
process.env.JWT_PARTNER_SECRET = process.env.JWT_PARTNER_SECRET || 'bench-partner-secret-key-at-least-32-chars'
process.env.CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || 'bench-captcha-secret-key-at-least-32-chars'
if (!process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
}

/** 打 N 次取分位数 */
async function measure (fn, times = 12) {
  const samples = []
  for (let i = 0; i < times; i++) {
    const t0 = process.hrtime.bigint()
    await fn()
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const pct = (p) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]
  return { p50: pct(0.5), p95: pct(0.95), min: samples[0], max: samples[samples.length - 1] }
}

function fmt (ms) {
  return ms >= 100 ? `${ms.toFixed(0)}ms` : `${ms.toFixed(1)}ms`
}

async function main () {
  // 顺序很重要：schema 必须在**模型定义之前**定下来，
  // 否则模型会被绑到默认的 public，SET search_path 救不回来。
  const { default: sequelize } = await import('../src/server/config/database.js')
  const schema = `bench_${process.pid}_${Date.now().toString(36)}`
  sequelize.options.define.schema = schema
  sequelize.dialect.queryGenerator.options.schema = schema
  await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
  // 每条连接都要切到该 schema（PG 的 enum 类型按 search_path 落位）
  sequelize.addHook('afterConnect', async (connection) => {
    await connection.query(`SET search_path TO "${schema}"`)
  })

  const { default: app } = await import('../src/server/app.js')
  const { syncModelsInDependencyOrder } = await import('../tests/setup/test-database.js')
  const { TestDataFactory } = await import('../tests/factories/index.js')
  const { TestHelpers } = await import('../tests/helpers/test-helpers.js')

  // 建表（按外键依赖顺序，和测试基建同一套逻辑）
  await syncModelsInDependencyOrder(sequelize)

  console.log('🌱 准备基准数据…')
  const { User, Product, Order, OrderItem, Administrator } = sequelize.models

  // 管理员（登录拿 token）
  // 密码由模型的 beforeSave 钩子自动哈希
  const admin = await Administrator.create({
    username: 'bench_admin',
    password: 'BenchPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  const adminToken = TestHelpers.generateAdminToken(admin)

  // 商品
  const categories = []
  for (let i = 0; i < 5; i++) {
    categories.push(await sequelize.models.ProductCategory.create(
      TestDataFactory.createProductCategory({ name: `BENCH-CAT-${i}` })
    ))
  }
  const products = []
  for (let i = 0; i < SIZE.products; i++) {
    products.push(await Product.create(TestDataFactory.createProduct({
      name: `BENCH-P-${i}`,
      stock: 1000,
      price: 100,
      status: 'active',
      category_id: categories[i % categories.length].id
    })))
  }

  // 用户 + 订单
  const users = []
  for (let i = 0; i < SIZE.users; i++) {
    users.push(await User.create(await TestDataFactory.createUser()))
  }
  for (let i = 0; i < SIZE.orders; i++) {
    const order = await Order.create(await TestDataFactory.createOrder(users[i % users.length].id, {
      status: 'shipping',
      // 工厂的 order_no 用毫秒时间戳，循环里会撞唯一键
      order_no: `BENCH-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    }))
    await OrderItem.create(await TestDataFactory.createOrderItem(
      order.id, products[i % products.length].id, { quantity: 1, price: 100 }
    ))
  }
  console.log(`   商品 ${SIZE.products} / 用户 ${SIZE.users} / 订单 ${SIZE.orders}`)

  // 起一个真实 server（走 HTTP 才算真实链路）
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const endpoints = [
    { name: 'GET /api/products', url: '/api/products' },
    { name: 'GET /api/products/:id', url: `/api/products/${products[0].id}` },
    { name: 'GET /api/coupons/available', url: '/api/coupons/available', auth: 'user' },
    { name: 'GET /api/admin/users', url: '/api/admin/users', auth: 'admin' },
    { name: 'GET /api/admin/statistics/overview', url: '/api/admin/statistics/overview', auth: 'admin' },
    { name: 'GET /api/admin/orders', url: '/api/admin/orders', auth: 'admin' }
  ]

  const userToken = TestHelpers.generateToken(users[0])
  const results = {}
  console.log('⏱  测量中…')
  for (const ep of endpoints) {
    const headers = {}
    if (ep.auth === 'admin') headers.Authorization = `Bearer ${adminToken}`
    if (ep.auth === 'user') headers.Authorization = `Bearer ${userToken}`
    results[ep.name] = await measure(async () => {
      const res = await fetch(base + ep.url, { headers })
      if (!res.ok) throw new Error(`${ep.name} → HTTP ${res.status}`)
      await res.arrayBuffer()
    })
  }

  await new Promise((resolve) => server.close(resolve))
  await sequelize.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
  await sequelize.close().catch(() => {})

  // 与基线比较
  let baseline = null
  if (fs.existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) } catch { /* 损坏就当没有 */ }
  }

  const regressions = []
  if (baseline?.endpoints) {
    for (const [name, cur] of Object.entries(results)) {
      const base95 = baseline.endpoints[name]?.p95
      if (base95 && cur.p95 > base95 * REGRESSION_RATIO) {
        regressions.push({ name, baseline: base95, current: cur.p95, ratio: cur.p95 / base95 })
      }
    }
  }

  if (jsonOnly) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), size: SIZE, endpoints: results }, null, 2))
  } else {
    console.log('')
    console.log('接口'.padEnd(38) + 'p50'.padStart(10) + 'p95'.padStart(10))
    console.log('-'.repeat(58))
    for (const [name, r] of Object.entries(results)) {
      console.log(name.padEnd(38) + fmt(r.p50).padStart(10) + fmt(r.p95).padStart(10))
    }
    console.log('-'.repeat(58))
    if (regressions.length) {
      console.log(`❌ ${regressions.length} 个接口明显退化（> ${REGRESSION_RATIO}× 基线）：`)
      for (const r of regressions) {
        console.log(`   ${r.name}: ${fmt(r.baseline)} → ${fmt(r.current)}（${r.ratio.toFixed(2)}×）`)
      }
    } else if (baseline) {
      console.log('✅ 无明显退化')
    } else {
      console.log('ℹ️ 没有基线可比（先跑一次 --update 生成）')
    }
  }

  if (update) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      size: SIZE,
      regressionRatio: REGRESSION_RATIO,
      endpoints: results
    }, null, 2))
    console.log(`\n💾 基线已写入 ${BASELINE_FILE}`)
  }

  process.exitCode = regressions.length ? 1 : 0
}

main().catch((err) => {
  console.error('❌ 基准执行失败：', err?.message || err)
  if (err?.errors) {
    for (const e of err.errors) console.error('   -', e.message, '（字段', e.path, '）')
  }
  if (process.env.BENCH_DEBUG) console.error(err?.stack)
  process.exit(1)
})
