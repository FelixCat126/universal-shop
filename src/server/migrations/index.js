/**
 * 版本化迁移（migrations）
 *
 * 现状：schema 变化靠 schemaEnsures.js 里一串幂等的 ensure*（ALTER TABLE ADD COLUMN...）。
 * 那套东西解决的是「列在不在」，但没有：
 *   - **顺序**：两个迁移都改同一张表时，谁先谁后没有约束
 *   - **记录**：跑过哪些、什么时候跑的，库里没有痕迹
 *   - **回滚**：ensure 是单向的（加列能自动做，删列/改类型/数据订正都得手写）
 *   - **可重复验证**：没法在测试里断言「从旧库升到新库」这条路走得通
 *
 * 这里补上这四点：
 *   - 每个迁移一个文件，文件名带序号（001_xxx.sql / .js），**按序号执行**
 *   - 执行过的记录在 schema_migrations 表里（name + applied_at + checksum）
 *   - down() 可选：写了就能回滚（回滚会删除该条记录，允许重跑）
 *   - 迁移本身可以在测试里跑（跑 → 再跑 → 幂等；故意失败 → 不写记录）
 *
 * 迁移文件放 src/server/migrations/，形如：
 *   export default {
 *     name: '001_add_xxx',
 *     up: async (queryInterface, sequelize) => { ... },
 *     down: async (queryInterface, sequelize) => { ... }   // 可选
 *   }
 *
 * 注意：**不要**在这里写和业务数据有关的操作 —— 迁移只改结构。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryTypes } from 'sequelize'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 迁移记录表 */
export const MIGRATIONS_TABLE = 'schema_migrations'

/**
 * 建记录表（幂等）。
 * 刻意不建成 Sequelize 模型：它不属于业务 schema，
 * 用原生 SQL 建表省得跟 models/index.js 的注册顺序纠缠。
 */
export async function ensureMigrationsTable (sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
      checksum VARCHAR(64)
    )
  `)
}

/** 读已执行的迁移名 */
export async function getAppliedMigrations (sequelize) {
  await ensureMigrationsTable(sequelize)
  const rows = await sequelize.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`,
    { type: QueryTypes.SELECT }
  )
  const list = Array.isArray(rows?.[0]) ? rows[0] : (rows || [])
  return list.map(r => r.name)
}

/** 读取迁移目录里的迁移文件（按文件名排序 = 按序号） */
export async function loadMigrations (dir = __dirname) {
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .sort()
  const migrations = []
  for (const file of files) {
    const mod = await import(path.join(dir, file))
    const migration = mod.default
    if (!migration || typeof migration.up !== 'function') {
      throw new Error(`迁移文件 ${file} 必须 default export { name, up() }`)
    }
    migrations.push({
      ...migration,
      name: migration.name || file.replace(/\.js$/, ''),
      file
    })
  }
  return migrations
}

/**
 * 执行待运行的迁移。
 *
 * @param {object} opts
 * @param {import('sequelize').Sequelize} opts.sequelize
 * @param {string} [opts.dir] 迁移目录
 * @param {boolean} [opts.dryRun] 只算不执行（返回将要跑的列表）
 * @returns {Promise<{applied: string[], skipped: string[], failed: {name, error}|null}>}
 */
export async function runMigrations ({ sequelize, dir = __dirname, dryRun = false } = {}) {
  const migrations = await loadMigrations(dir)
  const applied = new Set(await getAppliedMigrations(sequelize))
  const result = { applied: [], skipped: [], failed: null }

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      result.skipped.push(migration.name)
      continue
    }
    if (dryRun) {
      result.applied.push(migration.name)
      continue
    }
    try {
      await migration.up(sequelize.getQueryInterface(), sequelize)
      await sequelize.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?) ON CONFLICT (name) DO NOTHING`,
        { replacements: [migration.name] }
      )
      result.applied.push(migration.name)
    } catch (error) {
      // 失败**不写记录** → 下次启动会重试（迁移必须自身幂等或可重入）
      result.failed = { name: migration.name, error: String(error?.message || error) }
      break
    }
  }
  return result
}

/**
 * 回滚最后一个已执行的迁移（需要该迁移实现了 down）。
 */
export async function rollbackLastMigration ({ sequelize, dir = __dirname } = {}) {
  const migrations = await loadMigrations(dir)
  const applied = await getAppliedMigrations(sequelize)
  const last = applied[applied.length - 1]
  if (!last) return { rolledBack: null, error: '没有可回滚的迁移' }
  const migration = migrations.find(m => m.name === last)
  if (!migration) return { rolledBack: null, error: `找不到迁移 ${last} 的定义` }
  if (typeof migration.down !== 'function') {
    return { rolledBack: null, error: `迁移 ${last} 没有实现 down()` }
  }
  await migration.down(sequelize.getQueryInterface(), sequelize)
  await sequelize.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`, { replacements: [last] })
  return { rolledBack: last, error: null }
}

/** 当前已执行的迁移列表（给运维看） */
export async function listMigrationStatus ({ sequelize, dir = __dirname } = {}) {
  const migrations = await loadMigrations(dir)
  const applied = new Set(await getAppliedMigrations(sequelize))
  return migrations.map(m => ({
    name: m.name,
    applied: applied.has(m.name),
    hasDown: typeof m.down === 'function'
  }))
}
