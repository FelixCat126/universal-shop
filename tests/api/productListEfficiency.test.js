/**
 * 商品列表的效率护栏（第 56 轮）
 * ================================
 *
 * ## 为什么商品列表值得单独护
 *
 * 它是商城**最热**的一条查询（首页、搜索、分类筛选、合作方选品都走它），
 * 而且它的形状变化很容易**悄悄退化**：多 JOIN 一次、多取一列 TEXT、
 * 排序少一个键 —— 都不会报错，只是变慢。慢到一定程度才有人发现，
 * 那时商品表已经很大了。
 *
 * ## 用例
 *
 *   PE-1 公开列表只给**描述摘要**（≤200 字），详情页仍是完整描述
 *   PE-2 排序**全序确定**：同 created_at 的商品翻页不重不漏
 *   PE-3 计数的 SQL **不带 JOIN**（count 不需要分类名）
 *   PE-4 相关推荐的 SQL **不带分类 JOIN**（同一分类，名字已经有了）
 *   PE-5 复合索引**真的存在**（status+deleted_at+created_at+id 等）
 *   PE-6 关键词搜索**不进缓存**（缓存键无界，会把热门列表挤掉）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import sequelize from '@server/config/database.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { clearResponseCache } from '@server/utils/responseCache.js'

const models = () => TestDatabase.getSequelize().models

/** 抓一段时间内执行的所有 SQL */
function captureSql () {
  const orig = sequelize.query.bind(sequelize)
  const sqls = []
  sequelize.query = (...args) => {
    const first = args[0]
    const sql = typeof first === 'string' ? first : (first?.sql || '')
    if (sql) sqls.push(sql)
    return orig(...args)
  }
  return {
    sqls,
    restore () { sequelize.query = orig }
  }
}

describe('商品列表效率护栏', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
    // 响应缓存会跨用例存活 → 每次先清，否则拿到上一个用例的列表
    await clearResponseCache()
  })

  afterEach(async () => {
    await clearResponseCache()
  })

  it('PE-1 公开列表只给描述摘要，详情页仍是完整描述', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '效率测试分类', sort_order: 99 })
    const longText = '描'.repeat(600)
    const product = await Product.create(TestDataFactory.createProduct({
      name: 'PE-1 长描述商品',
      description: longText,
      category_id: cat.id,
      status: 'active',
      stock: 10
    }))

    const listRes = await request(app).get('/api/products?page=1&pageSize=10')
    expect(listRes.status).toBe(200)
    const row = listRes.body.data.products.find(p => p.id === product.id)
    expect(row, '列表里应能���到这个商品').toBeTruthy()
    expect(
      row.description.length,
      `列表把完整描述也带出来了（${row.description.length} 字）—— 卡片只显示两行`
    ).toBeLessThanOrEqual(200)

    const detailRes = await request(app).get(`/api/products/${product.id}`)
    expect(detailRes.status).toBe(200)
    expect(
      detailRes.body.data.description.length,
      '详情页必须给完整描述（SEO 与详情页都要）'
    ).toBe(600)
  })

  it('PE-2 排序全序确定：created_at 相同的商品翻页不重不漏', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '排序测试分类', sort_order: 98 })
    const sameTime = new Date('2026-01-01T00:00:00.000Z')

    const ids = []
    for (let i = 0; i < 5; i++) {
      const p = await Product.create(TestDataFactory.createProduct({
        name: `PE-2 同刻商品 ${i}`,
        category_id: cat.id,
        status: 'active',
        stock: 10
      }))
      // 强行改成**同一个** created_at —— 同一批导入时的真实情形
      await p.update({ created_at: sameTime }, { silent: true })
      await Product.update({ created_at: sameTime }, { where: { id: p.id } })
      ids.push(p.id)
    }

    const seen = []
    for (const page of [1, 2, 3]) {
      const res = await request(app).get(`/api/products?page=${page}&pageSize=2`)
      expect(res.status).toBe(200)
      const list = res.body.data.products.filter(p => ids.includes(p.id))
      seen.push(...list.map(p => p.id))
    }

    expect(seen.length, '同刻商品翻页后应恰好出现 5 次（不重不漏）').toBe(5)
    expect(new Set(seen).size, '翻页出现了重复商品').toBe(5)
    expect([...seen].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b))

    /**
     * 光靠行为断言不够：小数据量下 PG 恰好给出稳定顺序，
     * 去掉兜底键也可能"看起来没问题" —— 等数据量上来才暴露。
     * 所以再钉一条结构断言：排序键的**最后一级必须是 id**。
     */
    const cap = captureSql()
    try {
      await request(app).get('/api/products?page=1&pageSize=5').expect(200)
    } finally {
      cap.restore()
    }
    const listSql = cap.sqls.find(s => /order by/i.test(s) && /from\s+[^;]*"?products"?/i.test(s))
    expect(listSql, '没抓到列表查询的 SQL').toBeTruthy()
    const orderBy = listSql.slice(listSql.toUpperCase().indexOf('ORDER BY'))
    expect(
      /"id"\s+desc/i.test(orderBy),
      `排序键缺少 id 兜底 → created_at 相同的商品顺序不确定，翻页会重/漏：\n${orderBy.slice(0, 200)}`
    ).toBe(true)
  })

  it('PE-3 计数的 SQL 不带 JOIN', async () => {
    const cap = captureSql()
    try {
      await request(app).get('/api/products?page=1&pageSize=5').expect(200)
    } finally {
      cap.restore()
    }
    // 注意 SQL 里带 schema 前缀（"t_xxx"."products"），正则不能假设裸表名
    const counts = cap.sqls.filter(s => /count\(/i.test(s) && /from\s+[^;]*"?products"?/i.test(s))
    expect(counts.length, '应有一次 count 查询').toBeGreaterThan(0)
    for (const sql of counts) {
      expect(
        /join\s+[^;]*"?product_categories"?/i.test(sql),
        `count 查询里 JOIN 了分类表 —— 计数不需要分类名：\n${sql.slice(0, 300)}`
      ).toBe(false)
    }
  })

  it('PE-4 相关推荐的 SQL 不带分类 JOIN', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '推荐测试分类', sort_order: 97 })
    const main = await Product.create(TestDataFactory.createProduct({
      name: 'PE-4 主商品',
      category_id: cat.id,
      status: 'active',
      stock: 10
    }))
    for (let i = 0; i < 3; i++) {
      await Product.create(TestDataFactory.createProduct({
        name: `PE-4 推荐商品 ${i}`,
        category_id: cat.id,
        status: 'active',
        stock: 10
      }))
    }

    const cap = captureSql()
    try {
      const res = await request(app).get(`/api/products/${main.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data.related?.length, '应有相关推荐').toBeGreaterThan(0)
    } finally {
      cap.restore()
    }

    /**
     * 详情接口会查 products 两次：**主商品**（要 JOIN 分类拿分类名）
     * 与**相关推荐**（同一分类，分类名已经有了 → 不该再 JOIN）。
     *
     * 所以判据是"带分类 JOIN 的最多只能有一条"，而不是"一条都不能有"。
     */
    const productSqls = cap.sqls.filter(s =>
      /from\s+[^;]*"?products"?/i.test(s) && !/count\(/i.test(s)
    )
    expect(productSqls.length, '应有一次主查询 + 一次相关推荐查询').toBeGreaterThanOrEqual(2)

    // 正则要能匹配带 schema 前缀的表名："t_xxx"."product_categories"
    const withJoin = productSqls.filter(s => /join\s+[^;]*"?product_categories"?/i.test(s))
    expect(
      withJoin.length,
      `有 ${withJoin.length} 条商品查询 JOIN 了分类表 —— 相关推荐与主商品同分类，\n` +
      '那次 JOIN 是冗余的：\n' + withJoin.map(s => s.slice(0, 200)).join('\n---\n')
    ).toBeLessThanOrEqual(1)
  })

  it('PE-5 商品列表的复合索引存在', async () => {
    /**
     * 必须按 **current_schema()** 限定：
     * 测试库是"每个测试文件一个 schema"，并发跑时同一个库里有多份 products 表；
     * 不限定就会把**别的文件**的 schema 也算进来（它们的索引情况各不相同）
     * → 断言随机飘红（这正是"跨 schema 撞名"的老坑）。
     */
    const [rows] = await sequelize.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'products'
        AND schemaname = current_schema()
        AND indexname IN (
          'idx_products_public_list',
          'idx_products_public_list_category',
          'idx_products_updated_at'
        )
    `)
    const names = rows.map(r => r.indexname).sort()
    expect(
      names,
      '缺索引 → 列表每次翻页都要全量排序（商品上万后列表页明显变慢）'
    ).toEqual([
      'idx_products_public_list',
      'idx_products_public_list_category',
      'idx_products_updated_at'
    ])
  })

  it('PE-6 关键词搜索不进缓存（缓存键无界，会把热门列表挤掉）', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '缓存测试分类', sort_order: 96 })
    await Product.create(TestDataFactory.createProduct({
      name: 'PE-6 可搜索商品',
      category_id: cat.id,
      status: 'active',
      stock: 10
    }))

    // 普通列表：应进缓存
    const first = await request(app).get('/api/products?page=1&pageSize=5')
    const second = await request(app).get('/api/products?page=1&pageSize=5')
    expect(first.headers['x-cache']).toBe('MISS')
    expect(second.headers['x-cache'], '普通列表应命中缓存').toBe('HIT')

    // 关键词搜索：不应进缓存（每个关键词都是一条新键）
    const s1 = await request(app).get('/api/products?name=PE-6')
    const s2 = await request(app).get('/api/products?name=PE-6')
    expect(s1.status).toBe(200)
    expect(s2.status).toBe(200)
    expect(s2.headers['x-cache'], '关键词搜索被缓存了 —— 键空间无界，会挤掉热门列表').toBeUndefined()
  })
})
