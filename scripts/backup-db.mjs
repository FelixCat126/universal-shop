#!/usr/bin/env node
/**
 * 数据库备份（不依赖 pg_dump）
 *
 * ## 定位：生产备份用 pg_dump，本脚本是**无 pg_dump / 无 docker 时的备选**
 *
 * 生产环境走 scripts/db/backup-prod.sh（systemd timer 每日 02:40，
 * docker 内 pg_dump 16.14 —— 与服务端同版本），并已做过真实的隔离恢复演练。
 * 本脚本不依赖任何外部二进制，只用 Node + PG 协议，适合：
 *   - 本地 / CI 环境（没有 pg_dump 客户端）
 *   - 生产上 PG 容器临时不可用时的应急快照
 *
 * ⚠️ 本脚本只备**数据**，结构由迁移管理；恢复请配套 scripts/restore-db.mjs
 *    （它默认拒绝对非测试库执行，见那里的安全护栏）。
 *
 * ## 为什么不用 pg_dump
 *
 * 服务器（Alibaba Cloud Linux）源里只有 postgresql 13 客户端，
 * 而生产服务端是 PostgreSQL 16.14 —— pg_dump 13 会拒绝导 16
 * （server version mismatch），装了也用不了；官方 PGDG 源又要外网。
 *
 * ## 为什么只备份数据就够
 *
 * 本项目的结构由迁移管理（src/server/migrations/）：恢复时先跑迁移把结构建出来，
 * 再灌数据即可 —— 所以备份不需要包含 DDL，也与 pg_dump 的版本完全解耦。
 *
 * ## 三个实现上的坑（都踩过）
 *
 * 1. sequelize.query(sql, { type: SELECT }) 的行形状不稳定：
 *    业务表返回行对象数组，而查 information_schema 会返回行数组。
 *    -> 这里统一用 rowsOf() 归一化两种形状。
 * 2. 软删模型默认查不到已删除的行 -> 取数必须带 paranoid:false，
 *    否则备份会漏掉"已删除但数据还在"的商品/用户。
 * 3. 模型在定义时记住了表所属的 schema（测试基建每个文件一个 schema），
 *    改连接的 search_path 对模型查询不生效；改模型自己的 _schema 又会把它
 *    的 tableName 对象化、拼出 "[object Object].users" 这种坏表名。
 *    -> 所以这里用**原始 SQL + search_path**，不碰模型。
 *
 * ## 备份内容
 *
 *   database/backups/data-<时间戳>.tar.gz
 *     manifest.json        表清单、行数、已应用的迁移、PG 版本、备份时间
 *     tables/<表>.jsonl    每行一个 JSON 对象
 *     schema_migrations.json  已应用的迁移（人可读）
 *
 * ## 用法
 *
 *   node scripts/backup-db.mjs                 # 读 DATABASE_URL（本地走默认库）
 *   node scripts/backup-db.mjs --keep 14       # 保留最近 14 份（默认 7）
 *   node scripts/backup-db.mjs --out /path     # 指定输出目录
 *   node scripts/backup-db.mjs --schema my_sch # 只备份某个 schema
 */
import fs from 'node:fs'
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
const KEEP = Number(argVal('--keep', '7'))
const OUT_DIR = path.resolve(argVal('--out', path.join(ROOT, 'database', 'backups')))
const SCHEMA = String(argVal('--schema', '')).replace(/"/g, '')

// 连接串解析与 config/database.js 同一套规则（含本地默认库），否则本地/CI 用不了
const isTest = process.env.NODE_ENV === 'test'
const url = (isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL) ||
  process.env.DATABASE_URL ||
  (isTest ? 'postgres://shop:shop@127.0.0.1:5432/shop_test' : 'postgres://shop:shop@127.0.0.1:5432/shop_dev')
if (!url) {
  console.error('❌ 无法确定数据库连接串')
  process.exit(2)
}
// 指定 schema 时走**连接串的 options 参数**：
// 只用 SET search_path 的话，它只作用在连接池里的**某一条**连接上，
// 后续查询换到别的连接就失效了（表取不到）。options 是每条连接都带的。
const urlFinal = SCHEMA
  ? url + (url.includes('?') ? '&' : '?') + 'options=' + encodeURIComponent('-c search_path=' + SCHEMA)
  : url
process.env.DATABASE_URL = urlFinal

const { default: sequelize } = await import(path.join(ROOT, 'src/server/config/database.js'))
const { QueryTypes } = require('sequelize')

function stamp () {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/**
 * 归一化 query() 的返回形状（见文件头"坑 1"）。
 *
 * 实测有三种形状：
 *   A) [[行对象...], 元数据]     —— 元数据对象带 .rows
 *   B) [[值...], [值...], ...]  —— 行数组（information_schema 这类列类型解析不了时）
 *   C) [{...}, {...}]            —— 直接就是行对象数组
 *
 * ⚠️ B 形状下 result[0] 是**第一行**而不是行集合 —— 早先写成
 * 「Array.isArray(result[0]) 就返回 result[0]」把整批表查成了 1 张。
 */
function rowsOf (result) {
  if (!Array.isArray(result)) return []
  // 形状 A：找带 .rows 的元数据对象
  const meta = result.find(r => r && !Array.isArray(r) && Array.isArray(r.rows))
  if (meta) return meta.rows
  // 形状 C：首元素不是数组 → 整段就是行对象数组
  if (result.length && !Array.isArray(result[0])) return result
  // 形状 B：整段就是行数组
  return result
}

async function main () {
  if (SCHEMA) {
    // 引号包裹 schema 名（避免标识符注入）；search_path 决定了下面的原始 SQL 落在哪
    await sequelize.query(`SET search_path TO "${SCHEMA}"`)
  }

  // ⚠️ 防静默空备份：schema 不存在时 current_schema() 是 NULL，
  //    information_schema 查询会返回 0 张表 —— 而脚本照样打印备份完成。
  //    运维会以为备份好了，实际什么都没备。这是发布前的真实风险，必须当场失败。
  const cur = rowsOf(await sequelize.query('SELECT current_schema()::text AS s'))
  const curSchema = cur?.[0]?.s ?? cur?.[0]?.[0] ?? null
  if (!curSchema) {
    console.error('❌ current_schema() 为 NULL：schema 名拼错，或该 schema 不存在')
    console.error('   （若为此退出，恢复时会是空表恢复，把生产数据清成空）')
    process.exit(3)
  }
  if (SCHEMA && curSchema !== SCHEMA) {
    console.error(`❌ 期望 schema "${SCHEMA}"，实际生效的是 "${curSchema}"`)
    process.exit(3)
  }

  const ts = stamp()
  const dir = path.join(OUT_DIR, `data-${ts}`)
  const tablesDir = path.join(dir, 'tables')
  fs.mkdirSync(tablesDir, { recursive: true })

  let pgVersion = null
  try {
    const r = rowsOf(await sequelize.query('SHOW server_version', { type: QueryTypes.SELECT }))
    pgVersion = r[0]?.server_version || null
  } catch { /* 忽略 */ }

  const manifest = {
    created_at: new Date().toISOString(),
    kind: 'data-only',
    note: '结构由 src/server/migrations 管理；恢复时先跑迁移，再灌这些数据',
    pg_version: pgVersion,
    schema: SCHEMA || null,
    tables: []
  }

  // 业务表：按 current_schema() 列表 + 原始 SQL 取数（见文件头"坑 3"）
  const tableRows = rowsOf(await sequelize.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    { type: QueryTypes.SELECT }
  ))
  const tableNames = tableRows
    .map(r => (Array.isArray(r) ? r[0] : r?.table_name))
    .filter(Boolean)

  for (const table of tableNames) {
    let rows = []
    try {
      rows = rowsOf(await sequelize.query(`SELECT * FROM "${table}"`, { type: QueryTypes.SELECT }))
    } catch (e) {
      // 单张表取不到不能让整次备份失败
      manifest.tables.push({
        name: table,
        rows: 0,
        file: null,
        error: String(e.message).slice(0, 200)
      })
      continue
    }
    const file = path.join(tablesDir, `${table}.jsonl`)
    const content = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
    fs.writeFileSync(file, content)
    manifest.tables.push({ name: table, rows: rows.length, file: `tables/${table}.jsonl` })
  }

  // 已应用的迁移
  try {
    const { getAppliedMigrations } = await import(path.join(ROOT, 'src/server/migrations/index.js'))
    const applied = await getAppliedMigrations(sequelize)
    manifest.migrations = applied
    fs.writeFileSync(path.join(dir, 'schema_migrations.json'), JSON.stringify(applied, null, 2))
  } catch (e) {
    manifest.migrations = []
    manifest.migrations_error = String(e.message).slice(0, 200)
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // 打包
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const tarPath = path.join(OUT_DIR, `data-${ts}.tar.gz`)
  execFileSync('tar', ['-czf', tarPath, '-C', OUT_DIR, path.basename(dir)], { stdio: 'pipe' })
  fs.rmSync(dir, { recursive: true, force: true })

  // 轮转：只保留最近 KEEP 份
  const all = fs.readdirSync(OUT_DIR).filter(f => /^data-.*\.tar\.gz$/.test(f)).sort()
  while (all.length > KEEP) {
    const old = all.shift()
    fs.rmSync(path.join(OUT_DIR, old), { force: true })
    console.log(`🗑 已清理旧备份 ${old}`)
  }

  // 一张表都没备到 = 备份无效（宁可报错也不能让人以为成功）
  if (manifest.tables.length === 0) {
    console.error('❌ 备份失败：schema 下没有任何表（0 张表），这不构成有效备份')
    process.exit(3)
  }

  const totalRows = manifest.tables.reduce((s, t) => s + (t.rows || 0), 0)
  const failed = manifest.tables.filter(t => t.error).length
  console.log(`✅ 备份完成：${tarPath}`)
  console.log(`   表 ${manifest.tables.length} 张 / 共 ${totalRows} 行；已应用迁移 ${manifest.migrations.length} 条${failed ? `；⚠️ ${failed} 张表取数失败` : ''}`)
  if (failed) process.exitCode = 1
}

main()
  .then(async () => { await sequelize.close(); process.exit(process.exitCode || 0) })
  .catch(async (e) => {
    console.error('❌ 备份失败:', e.message)
    try { await sequelize.close() } catch {}
    process.exit(1)
  })
