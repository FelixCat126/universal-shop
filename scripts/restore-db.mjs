#!/usr/bin/env node
/**
 * 从备份恢复数据（配套 scripts/backup-db.mjs）
 *
 * ## 定位：**不是生产恢复脚本**
 *
 * 生产恢复走 scripts/db/restore-prod.sh（pg_dump / pg_restore 链路，
 * 已在生产做过真实的隔离恢复演练：27 张表逐表行数与备份快照一致）。
 * 本脚本是**不依赖 pg_dump / docker** 的备选路径 —— 适用于本地、CI、
 * 或生产上 PG 容器恰好不可用时的应急恢复。
 *
 * 两者的取舍：
 *   - pg_dump 链路：结构 + 数据 + 索引 + 约束一起备，生产首选
 *   - 本脚本：只备数据，结构靠迁移重建；不依赖任何外部二进制
 *
 * ⚠️ 因为本脚本会 TRUNCATE 目标表，它默认**拒绝**对非测试库执行，
 *    必须显式 --allow-prod 才会放行（见下方安全护栏）。
 *
 * ## 恢复流程
 *
 *   1. 解开备份 → 读 manifest（表清单、行数、已应用的迁移）
 *   2. **先跑迁移**把结构建出来（备份只含数据，结构由迁移管理）
 *   3. TRUNCATE 全部表（CASCADE，一次清空）
 *   4. 按 **FK 依赖顺序**灌数据（从 pg_constraint 现场算拓扑序，
 *      不写死顺序 —— 表一多，写死的顺序必然漏）
 *
 * ## 为什么不用 SET session_replication_role = replica
 *
 * 那是 superuser 权限，且会连带关掉外键触发器（恢复过程里一旦顺序错，
 * 数据就以"脏"的状态落库）。这里改成"按依赖顺序插入"，
 * 外键全程生效 —— 恢复出错会**立刻报错**，而不是悄悄写进坏数据。
 *
 * ## 用法
 *
 *   node scripts/restore-db.mjs --from database/backups/data-xxx.tar.gz
 *   node scripts/restore-db.mjs --from <tar> --skip-migrate   # 结构已就位时跳过迁移
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(ROOT, '.env') })

const args = process.argv.slice(2)
const argVal = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const hasFlag = (name) => args.includes(name)
const SCHEMA = argVal('--schema', '')

const FROM = argVal('--from', '')
if (!FROM) {
  console.error('❌ 需要 --from <备份 tar.gz 路径>')
  process.exit(2)
}
const SKIP_MIGRATE = hasFlag('--skip-migrate')

const isTest = process.env.NODE_ENV === 'test'
const url = (isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL) ||
  process.env.DATABASE_URL ||
  (isTest ? 'postgres://shop:shop@127.0.0.1:5432/shop_test' : 'postgres://shop:shop@127.0.0.1:5432/shop_dev')
// 指定 schema 时走**连接串的 options 参数**：
// 只用 SET search_path 的话，它只作用在连接池里的**某一条**连接上，
// 后续查询换到别的连接就失效了（表取不到）。options 是每条连接都带的。
const urlFinal = SCHEMA
  ? url + (url.includes('?') ? '&' : '?') + 'options=' + encodeURIComponent('-c search_path=' + SCHEMA)
  : url
process.env.DATABASE_URL = urlFinal

const { default: sequelize } = await import(path.join(ROOT, 'src/server/config/database.js'))
await import(path.join(ROOT, 'src/server/models/index.js'))
const { QueryTypes } = require('sequelize')

// 可选：把备份/恢复限定到某个 schema（测试用独立 schema，不碰主库）

/**
 * 归一化 query() 的返回形状（三种：[[行对象...],元数据] / 行数组 / 行对象数组）。
 * ⚠️ 行数组形状下 result[0] 是**第一行**而不是行集合 —— 别写成 result[0]。
 */
function rowsOf (result) {
  if (!Array.isArray(result)) return []
  const meta = result.find(r => r && !Array.isArray(r) && Array.isArray(r.rows))
  if (meta) return meta.rows
  return result
}

/**
 * 按外键依赖算插入顺序（父表在前）。
 * 有环时按剩余表的字典序兜底（业务上不该有环，有环说明迁移设计有问题）。
 */
async function dependencyOrder (tableNames) {
  const fks = rowsOf(await sequelize.query(`
    SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent
      FROM pg_constraint con
     WHERE con.contype = 'f' AND connamespace = current_schema()::regnamespace
  `, { type: QueryTypes.SELECT }))

  const set = new Set(tableNames)
  const parents = new Map(tableNames.map(t => [t, new Set()]))
  for (const fk of fks) {
    const child = String(fk.child)
    const parent = String(fk.parent)
    if (!set.has(child) || !set.has(parent) || child === parent) continue
    parents.get(child).add(parent)
  }

  const ordered = []
  const done = new Set()
  let guard = 0
  while (ordered.length < tableNames.length && guard++ < tableNames.length + 5) {
    for (const t of tableNames) {
      if (done.has(t)) continue
      const deps = [...parents.get(t)].filter(d => !done.has(d))
      if (deps.length === 0) {
        ordered.push(t)
        done.add(t)
      }
    }
  }
  for (const t of tableNames) if (!done.has(t)) ordered.push(t)
  return ordered
}

/**
 * 安全护栏：默认只允许恢复到测试/演练库。
 *
 * 本脚本会先 TRUNCATE 目标表再灌数据 —— 一旦目标库选错，数据就没了。
 * 生产恢复请用 scripts/db/restore-prod.sh（它有目标库非空时拒绝的护栏）。
 */
function assertRestoreTargetAllowed (url) {
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  const isSafeName = /(^|[_-])(test|dev|drill|staging|local|tmp)([_-]|$)/i.test(dbName)
  if (isSafeName) return dbName
  if (hasFlag('--allow-prod')) {
    console.log(`⚠️ --allow-prod：将对目标库 "${dbName}" 执行 TRUNCATE + 恢复`)
    return dbName
  }
  console.error(`❌ 拒绝恢复：目标库 "${dbName}" 不像测试/演练库`)
  console.error('   本脚本会先清空目标表。确认无误后加 --allow-prod 再执行。')
  console.error('   （生产恢复请用 scripts/db/restore-prod.sh）')
  process.exit(4)
}

async function main () {
  const targetDb = assertRestoreTargetAllowed(urlFinal)
  console.log(`🎯 目标库: ${targetDb}`)
  if (SCHEMA) {
    // 引号包裹 schema 名（避免标识符注入）
    await sequelize.query('SET search_path TO "' + SCHEMA.replace(/"/g, '') + '"')
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-restore-'))
  execFileSync('tar', ['-xzf', path.resolve(FROM), '-C', tmp], { stdio: 'pipe' })
  const root = fs.readdirSync(tmp)[0]
  const dir = path.join(tmp, root)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))

  console.log(`📦 备份：${manifest.created_at} / 表 ${manifest.tables.length} 张 / PG ${manifest.pg_version}`)

  // ⚠️ 空备份绝不能用来恢复：下面会 TRUNCATE 全部表，
  //    如果备份里没有数据，恢复完就是一张空库 = 数据全没了。
  //    这里必须当场拒绝。
  if (!manifest.tables || manifest.tables.length === 0) {
    console.error('❌ 拒绝恢复：备份里没有任何表（0 张表）')
    console.error('   恢复会先清空目标表再灌数据 —— 空备份会把库清成空')
    process.exit(3)
  }

  // 1) 结构：先跑迁移
  if (!SKIP_MIGRATE) {
    const { runMigrations } = await import(path.join(ROOT, 'src/server/migrations/index.js'))
    const res = await runMigrations({ sequelize })
    console.log(`🧱 迁移完成：成功 ${res.applied?.length ?? 0} 条`)
  }

  // 2) 清空（一次 TRUNCATE CASCADE，避免逐表清空时的外键顺序问题）
  const tables = manifest.tables.map(t => t.name).filter(Boolean)
  if (tables.length) {
    await sequelize.query(`TRUNCATE TABLE ${tables.map(t => `"${t}"`).join(', ')} CASCADE`)
    console.log('🧹 已清空目标表')
  }

  // 3) 按依赖顺序灌数据
  const order = await dependencyOrder(tables)
  let restored = 0
  for (const table of order) {
    const meta = manifest.tables.find(t => t.name === table)
    if (!meta || !meta.file) continue
    const file = path.join(dir, meta.file)
    if (!fs.existsSync(file)) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    if (!lines.length) continue

    // 批量 INSERT（参数化）：大表逐行往返会慢到不可用
    // —— 生产 administrative_regions 有 8000+ 行，逐行就是 8000 次网络往返。
    // 列名取所有行的**交集**，保证每行都有值；缺列的行按 NULL 处理。
    const objs = lines.map(l => JSON.parse(l)).filter(o => o && Object.keys(o).length)
    if (!objs.length) continue
    // 列取**并集**（不是交集）：某行缺列时该列按 NULL 处理。
    // 用交集的话，行结构一旦有差异，整张表会被跳过 = 静默丢数据；
    // 用并集则顶多是该列全 NULL，或列不存在时报错（响亮失败，可接受）。
    const keys = [...new Set(objs.flatMap(o => Object.keys(o)))]
    if (!keys.length) continue
    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < objs.length; i += BATCH) {
      const chunk = objs.slice(i, i + BATCH)
      const values = []
      const placeholders = []
      const replacements = {}
      chunk.forEach((obj, r) => {
        const tuple = []
        keys.forEach((k, c) => {
          const name = `${table}_b${i}_${r}_${c}`
          const v = obj[k] === undefined ? null : obj[k]
          replacements[name] = v
          tuple.push(`:${name}`)
        })
        values.push(`(${tuple.join(', ')})`)
        placeholders.push(tuple)
      })
      await sequelize.query(
        `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES ${values.join(', ')}`,
        { replacements }
      )
      inserted += chunk.length
    }
    restored += inserted
    if (inserted) console.log(`  ✓ ${table}: ${inserted} 行`)
  }
  console.log(`✅ 恢复完成：共 ${restored} 行`)
  fs.rmSync(tmp, { recursive: true, force: true })
}

main()
  .then(async () => { await sequelize.close(); process.exit(0) })
  .catch(async (e) => {
    console.error('❌ 恢复失败:', e.message)
    try { await sequelize.close() } catch {}
    process.exit(1)
  })
