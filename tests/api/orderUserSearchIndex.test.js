/**
 * 订单/用户搜索的 trigram 索引测试
 *
 *   SI-1 迁移幂等
 *   SI-2 六个索引都建出来了且有效
 *   SI-3 规划器用得上（订单号 / 收货人 / 电话）
 *   SI-4 规划器用得上（昵称 / 手机 / 用户名）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import migration from '@server/migrations/006_order_user_search_trgm_index.js'

let sequelize

async function runMigration () {
  await migration.up(sequelize.getQueryInterface(), sequelize)
}

async function indexExists (name) {
  const [rows] = await sequelize.query(
    'SELECT indexname FROM pg_indexes WHERE indexname = ?',
    { replacements: [name] }
  )
  return rows.length > 0
}

async function explain (sql) {
  const [rows] = await sequelize.query(`EXPLAIN ${sql}`)
  return rows.map(r => Object.values(r)[0]).join('\n')
}

beforeAll(async () => {
  sequelize = TestDatabase.getSequelize()
  await runMigration()
})

afterAll(async () => {
  for (const n of [
    'idx_user_username_trgm',
    'idx_user_phone_trgm',
    'idx_user_nickname_trgm',
    'idx_order_contact_phone_trgm',
    'idx_order_contact_name_trgm',
    'idx_order_order_no_trgm'
  ]) {
    await sequelize.query(`DROP INDEX IF EXISTS ${n}`).catch(() => {})
  }
})

describe('订单/用户搜索 trigram 索引', () => {
  it('SI-1 迁移幂等', async () => {
    await expect(runMigration()).resolves.not.toThrow()
    await expect(runMigration()).resolves.not.toThrow()
  })

  it('SI-2 六个索引都建出来了', async () => {
    for (const name of [
      'idx_order_order_no_trgm',
      'idx_order_contact_name_trgm',
      'idx_order_contact_phone_trgm',
      'idx_user_nickname_trgm',
      'idx_user_phone_trgm',
      'idx_user_username_trgm'
    ]) {
      expect(await indexExists(name), name).toBe(true)
    }
  })

  it('SI-3 订单搜索用得上索引', async () => {
    await sequelize.query('SET enable_seqscan = off')
    try {
      expect(await explain(`SELECT * FROM orders WHERE order_no LIKE '%BENCH%'`))
        .toMatch(/idx_order_order_no_trgm/)
      expect(await explain(`SELECT * FROM orders WHERE contact_name LIKE '%收货人%'`))
        .toMatch(/idx_order_contact_name_trgm/)
      expect(await explain(`SELECT * FROM orders WHERE contact_phone LIKE '%139%'`))
        .toMatch(/idx_order_contact_phone_trgm/)
    } finally {
      await sequelize.query('SET enable_seqscan = on')
    }
  })

  it('SI-4 用户搜索用得上索引', async () => {
    await sequelize.query('SET enable_seqscan = off')
    try {
      expect(await explain(`SELECT * FROM users WHERE nickname LIKE '%昵称%'`))
        .toMatch(/idx_user_nickname_trgm/)
      expect(await explain(`SELECT * FROM users WHERE phone LIKE '%139%'`))
        .toMatch(/idx_user_phone_trgm/)
      expect(await explain(`SELECT * FROM users WHERE username LIKE '%user%'`))
        .toMatch(/idx_user_username_trgm/)
    } finally {
      await sequelize.query('SET enable_seqscan = on')
    }
  })
})
