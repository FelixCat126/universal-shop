#!/usr/bin/env node
/**
 * 向 scripts/db/patches/ 放入 017_*.sql … 028_*.sql（三位数字前缀，见该目录）。
 * 仅在「已有数据库」upgrade 时在 sync 前先执行补丁；全新空库会先 sync 再跑补丁（列若已存在会提示 duplicate 并跳过）。
 * 目录为空则完全不访问数据库。执行失败若提示列已存在则跳过并记录。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PATCHES_DIR = path.join(__dirname, 'patches')

/** 去掉行注释、按分号拆分，逐条执行（避免 SQLite 下整段 SQL 只执行第一条而跳过后面的 ALTER） */
function toExecutableStatements (sql) {
  const noLineComments = sql.replace(/--[^\r\n]*/g, '')
  return noLineComments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
export async function applySqlPatches (sequelize) {
  if (!fs.existsSync(PATCHES_DIR)) {
    console.log('ℹ️  未找到 patches 目录，跳过 SQL 补丁')
    return
  }

  // 仅执行 010_xxx.sql 形式的真实补丁；忽略 macOS AppleDouble（._*）、隐藏文件等
  const isValidPatchName = (f) =>
    typeof f === 'string' &&
    f.endsWith('.sql') &&
    !f.startsWith('._') &&
    !f.startsWith('.') &&
    /^\d{3}_[A-Za-z0-9._-]+\.sql$/.test(f)

  const files = fs.readdirSync(PATCHES_DIR).filter(isValidPatchName).sort()
  if (files.length === 0) {
    console.log('ℹ️  patches 目录下无有效 .sql 补丁，跳过（不改表结构）')
    return
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS _sql_patches_applied (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  for (const file of files) {
    const [exists] = await sequelize.query(
      'SELECT 1 AS ok FROM _sql_patches_applied WHERE name = ? LIMIT 1',
      { replacements: [file] }
    )
    if (exists.length > 0) continue

    const fullPath = path.join(PATCHES_DIR, file)
    const raw = fs.readFileSync(fullPath)
    if (raw.slice(0, Math.min(raw.length, 512)).includes(0)) {
      console.warn(`⚠️ 跳过非文本补丁（疑似二进制）: ${file}`)
      await sequelize.query(
        'INSERT INTO _sql_patches_applied (name) VALUES (?)',
        { replacements: [file] }
      )
      continue
    }
    const sql = raw.toString('utf8').trim()
    if (!sql) {
      await sequelize.query(
        'INSERT INTO _sql_patches_applied (name) VALUES (?)',
        { replacements: [file] }
      )
      continue
    }

    const statements = toExecutableStatements(sql)
    if (statements.length === 0) {
      await sequelize.query(
        'INSERT INTO _sql_patches_applied (name) VALUES (?)',
        { replacements: [file] }
      )
      continue
    }

    console.log(`📄 SQL 补丁: ${file}（${statements.length} 条语句）`)
    try {
      for (const stmt of statements) {
        await sequelize.query(stmt)
      }
    } catch (e) {
      const msg = e?.message || String(e)
      if (/duplicate column name|already exists/i.test(msg)) {
        console.warn(`   ⚠️ 已存在或已应用，跳过: ${msg.split('\n')[0]}`)
      } else {
        throw e
      }
    }

    await sequelize.query(
      'INSERT INTO _sql_patches_applied (name) VALUES (?)',
      { replacements: [file] }
    )
  }
  console.log('✅ SQL 补丁流程结束')
}
