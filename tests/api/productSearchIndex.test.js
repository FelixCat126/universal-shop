/**
 * 商品搜索的 trigram 索引测试
 *
 * 商品搜索是 `name LIKE '%kw%' OR name_th LIKE '%kw%'`。
 * **前导通配符的 LIKE 用不了 btree 索引** —— PG 只能全表扫，
 * 而且是"越准越慢"：命中越少，扫的行越多。
 *
 *   实测（3 万商品，命中 1 行）：无索引 10.4ms → 有 trigram 索引 1.2ms
 *
 * 这里守住三件事：
 *   PS-1 迁移能跑，且幂等（重复跑不报错）
 *   PS-2 索引真的建出来了（名字 + opclass）
 *   PS-3 规划器**用得上**这个索引（用 enable_seqscan=off 强制验证可用性，
 *        而不是靠"造很多数据看快慢" —— 那样测试又慢又不稳）
 *   PS-4 关键词里带 % / _ （会被转义）时索引依然可用
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import migration from '@server/migrations/004_product_search_trgm_index.js'
import aliasMigration from '@server/migrations/005_product_alias_trgm_index.js'

let sequelize

/** 跑迁移（幂等） */
async function runMigration () {
  await migration.up(sequelize.getQueryInterface(), sequelize)
}

/** 索引是否存在 */
async function indexExists (name) {
  const [rows] = await sequelize.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'products' AND indexname = ?`,
    { replacements: [name] }
  )
  return rows.length > 0
}

/** 执行计划文本 */
async function explain (sql) {
  const [rows] = await sequelize.query(`EXPLAIN ${sql}`)
  return rows.map(r => Object.values(r)[0]).join('\n')
}

beforeAll(async () => {
  sequelize = TestDatabase.getSequelize()
  await runMigration()
  await aliasMigration.up(sequelize.getQueryInterface(), sequelize)
})

afterAll(async () => {
  // 索引留着不影响别的测试（sync 不删索引），
  // 但为保持测试库干净，这里把它删掉
  await sequelize.query('DROP INDEX IF EXISTS idx_product_alias_trgm').catch(() => {})
  await sequelize.query('DROP INDEX IF EXISTS idx_product_name_th_trgm').catch(() => {})
  await sequelize.query('DROP INDEX IF EXISTS idx_product_name_trgm').catch(() => {})
})

describe('商品搜索 trigram 索引', () => {
  it('PS-1 迁移幂等：重复执行不报错', async () => {
    await expect(runMigration()).resolves.not.toThrow()
    await expect(runMigration()).resolves.not.toThrow()
  })

  it('PS-2 索引建出来了（GIN + gin_trgm_ops）', async () => {
    expect(await indexExists('idx_product_name_trgm')).toBe(true)
    expect(await indexExists('idx_product_name_th_trgm')).toBe(true)

    const [rows] = await sequelize.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'products' AND indexname = 'idx_product_name_trgm'`
    )
    const def = Object.values(rows[0])[0]
    expect(def).toMatch(/USING gin/i)
    expect(def).toMatch(/gin_trgm_ops/)
  })

  it('PS-3 规划器用得上这个索引（LIKE %kw% 也能走）', async () => {
    // 关掉顺序扫描的偏好：如果索引不可用，PG 就没别的选择了
    await sequelize.query('SET enable_seqscan = off')
    try {
      const plan = await explain(`SELECT * FROM products WHERE name LIKE '%zapple%'`)
      expect(plan).toMatch(/idx_product_name_trgm/)
    } finally {
      await sequelize.query('SET enable_seqscan = on')
    }
  })

  it('PS-4 关键词含 % / _ （会被转义成字面量）时索引依然可用', async () => {
    // likeContains 会把 % 转成 \% —— 转义后的模式仍然能被 trigram 索引处理
    await sequelize.query('SET enable_seqscan = off')
    try {
      const plan = await explain(`SELECT * FROM products WHERE name LIKE '%\\%%' ESCAPE '\\'`)
      // 允许规划器给出 Bitmap Index Scan 或 Index Scan —— 两者都说明用上了索引
      expect(plan).toMatch(/idx_product_name_trgm/)
    } finally {
      await sequelize.query('SET enable_seqscan = on')
    }
  })

  it('PS-4b 别名也有 trigram 索引（别名参与搜索）', async () => {
    expect(await indexExists('idx_product_alias_trgm')).toBe(true)
    await sequelize.query('SET enable_seqscan = off')
    try {
      const plan = await explain(`SELECT * FROM products WHERE alias LIKE '%口头叫法%'`)
      expect(plan).toMatch(/idx_product_alias_trgm/)
    } finally {
      await sequelize.query('SET enable_seqscan = on')
    }
  })

  it('PS-5 中文/泰文关键词同样能用（trigram 不依赖分词）', async () => {
    await sequelize.query('SET enable_seqscan = off')
    try {
      const zh = await explain(`SELECT * FROM products WHERE name LIKE '%奶茶%'`)
      expect(zh).toMatch(/idx_product_name_trgm/)
      const th = await explain(`SELECT * FROM products WHERE name_th LIKE '%กลิ่น%'`)
      expect(th).toMatch(/idx_product_name_th_trgm/)
    } finally {
      await sequelize.query('SET enable_seqscan = on')
    }
  })
})
