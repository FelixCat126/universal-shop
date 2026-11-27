/**
 * 深水区查询效率护栏（第 57 轮）
 * ============================
 *
 * ## 与第 49 轮那套的区别
 *
 * `queryEfficiencyGuard.test.js`（第 49 轮）护的是**通用规矩**：
 * 列表接口要有 limit、关键接口要挂缓存、索引要建。
 *
 * 这一轮护的是**三条具体路径**的问题，它们都不会报错，
 * 只在"数据变多"或"运营同时开两个页面"时显形：
 *
 *   - CSV 导出把整表装进内存 → 几万件商品就能把进程顶到几百 MB
 *   - 统计的 COUNT(*) FILTER 是全表扫 → 商品上万后每 15 秒白扫一遍
 *   - 综合统计的缓存不写时失效 → 改完库存，两个端点给两个数字
 *
 * ## 用例
 *
 *   GE-1 CSV 导出**分批**（每条查询都有 LIMIT，不许全表查询）+ 行数不丢
 *   GE-2 低库存/缺货走**索引区间**（不许 COUNT(*) FILTER 全表聚合）+ 口径不变
 *   GE-3 综合统计与总览的**低库存数字一致**（写时失效生效）
 *   GE-4 缓存失效**按域**：改商品不清订单统计的缓存
 *   GE-5 商品分类的 sort_order 索引**模型与库一致**
 *   GE-6 合作方商品列表**不带**用不上的 description
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import sequelize from '@server/config/database.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { streamProductsCsv } from '@server/services/productCsvService.js'
import {
  getCachedOrderStats,
  setCachedOrderStats,
  invalidateStatsCaches
} from '@server/utils/statsCache.js'

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

describe('深水区查询效率护栏（第 57 轮）', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
    invalidateStatsCaches('all')
  })

  /**
   * 管理员 token（统计接口挂在 /api/admin/statistics 下，要鉴权）。
   *
   * 直接建号 + 签 token，不走登录接口 —— 登录接口有验证码/限流/强制改密等一堆前置，
   * 这里只是要一个能过鉴权的 token，不需要验证登录流程本身。
   */
  async function adminToken () {
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    return TestHelpers.generateAdminToken(admin)
  }

  it('GE-1 CSV 导出分批取数（每条查询都有 LIMIT），且行数不丢', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '导出测试分类', sort_order: 95 })
    const total = 25
    for (let i = 0; i < total; i++) {
      await Product.create(TestDataFactory.createProduct({
        name: `GE-1 商品 ${i}`,
        category_id: cat.id,
        status: 'active',
        stock: 1
      }))
    }

    const cap = captureSql()
    let csv = ''
    try {
      for await (const chunk of streamProductsCsv({ batchSize: 10 })) {
        csv += chunk
      }
    } finally {
      cap.restore()
    }

    const lines = csv.trim().split('\r\n')
    expect(lines.length, '导出的行数应等于商品数 + 表头').toBe(total + 1)
    expect(lines[0]).toContain('name')

    const productQueries = cap.sqls.filter(s =>
      /from\s+[^;]*"?products"?/i.test(s) && !/count\(/i.test(s)
    )
    expect(productQueries.length, '应按批查询（25 件 / 每批 10 → 3 次）').toBeGreaterThan(1)
    for (const sql of productQueries) {
      expect(
        /limit\s+\d+/i.test(sql),
        `有一条导出查询没有 LIMIT —— 那是全表查询，内存会随商品数线性涨：\n${sql.slice(0, 200)}`
      ).toBe(true)
    }
  })

  it('GE-2 低库存/缺货走索引区间，且口径不变', async () => {
    const { Product } = models()
    // 5 件低库存（1..10）、3 件缺货、2 件正常
    for (let i = 0; i < 5; i++) {
      await Product.create(TestDataFactory.createProduct({ name: `GE-2 低 ${i}`, stock: i + 1, status: 'active' }))
    }
    for (let i = 0; i < 3; i++) {
      await Product.create(TestDataFactory.createProduct({ name: `GE-2 缺 ${i}`, stock: 0, status: 'active' }))
    }
    await Product.create(TestDataFactory.createProduct({ name: 'GE-2 正常', stock: 100, status: 'active' }))

    const token = await adminToken()
    const cap = captureSql()
    let body
    try {
      const res = await request(app)
        .get('/api/admin/statistics/overview')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      body = res.body.data
    } finally {
      cap.restore()
    }

    expect(body.lowStock, '低库存口径：1 ≤ stock ≤ 10').toBe(5)
    expect(body.outOfStock, '缺货口径：stock = 0').toBe(3)

    const stockCounts = cap.sqls.filter(s => /count\(/i.test(s) && /stock/i.test(s))
    expect(stockCounts.length, '应有用 stock 条件的 count 查询').toBeGreaterThan(0)
    for (const sql of stockCounts) {
      expect(
        /filter\s*\(/i.test(sql),
        `统计还在用 COUNT(*) FILTER（全表扫）：\n${sql.slice(0, 200)}`
      ).toBe(false)
    }
  })

  it('GE-3 改了库存后，综合统计与总览的低库存数字一致', async () => {
    /**
     * 必须**打开缓存**才能测出这条：
     * 测试环境默认旁路缓存（测试库每个用例清库，缓存会串用例），
     * 旁路时综合统计每次都现算 → 两个端点天然一致 → 这条护栏就是永远绿的。
     *
     * 打开缓存后：综合统计**第一次**请求进缓存，
     * 改库存 → 写时失效必须把它清掉 → 第二次请求才是新数字。
     */
    const prevCache = process.env.STATS_CACHE_ENABLED
    process.env.STATS_CACHE_ENABLED = '1'
    try {
      const { Product } = models()
    await Product.create(TestDataFactory.createProduct({ name: 'GE-3 商品', stock: 5, status: 'active' }))

    const token = await adminToken()
    const overview1 = await request(app)
      .get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    const comprehensive1 = await request(app)
      .get('/api/admin/statistics/comprehensive')
      .set('Authorization', `Bearer ${token}`)
    expect(overview1.status).toBe(200)
    expect(comprehensive1.status).toBe(200)

    // 改库存 → 写时失效应该让两个端点都看到新数字
    await Product.update({ stock: 0 }, { where: { name: 'GE-3 商品' } })

    const overview2 = await request(app)
      .get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${token}`)
    const comprehensive2 = await request(app)
      .get('/api/admin/statistics/comprehensive')
      .set('Authorization', `Bearer ${token}`)

    // 总览是平铺的 { lowStock, outOfStock }；综合统计是 { overview: {...} }
    const pick = (body, key) => {
      if (body?.data?.[key] !== undefined) return body.data[key]
      if (body?.data?.overview?.[key] !== undefined) return body.data.overview[key]
      if (body?.[key] !== undefined) return body[key]
      return undefined
    }

    const ovLow = pick(overview2.body, 'lowStock')
    const ovOut = pick(overview2.body, 'outOfStock')
    const cpLow = pick(comprehensive2.body, 'lowStock')
    const cpOut = pick(comprehensive2.body, 'outOfStock')

    expect(ovLow, '总览的低库存数（改完应是 0）').toBe(0)
    expect(ovOut, '总览的缺货数（改完应是 1）').toBe(1)
    expect(cpLow, '综合统计的低库存数与总览不一致 —— 它的缓存没被写时失效清掉').toBe(ovLow)
    expect(cpOut, '综合统计的缺货数与总览不一致 —— 它的缓存没被写时失效清掉').toBe(ovOut)
    } finally {
      if (prevCache === undefined) delete process.env.STATS_CACHE_ENABLED
      else process.env.STATS_CACHE_ENABLED = prevCache
    }
  })

  it('GE-4 缓存失效按域：改商品不清订单统计的缓存', () => {
    // 测试环境默认旁路缓存（测试库每个用例清库，缓存会串用例）→ 这里显式打开
    const prev = process.env.STATS_CACHE_ENABLED
    process.env.STATS_CACHE_ENABLED = '1'
    try {
      setCachedOrderStats('filter-a', { total: 1 })
      setCachedOrderStats('filter-b', { total: 2 })

      invalidateStatsCaches('product')

      expect(
        getCachedOrderStats('filter-a'),
        '改商品把订单统计的缓存也清了 —— 改商品不会改营收，白白让面板重算'
      ).toBeTruthy()

      invalidateStatsCaches('order')
      expect(getCachedOrderStats('filter-a'), '改订单必须清订单统计缓存').toBeFalsy()
    } finally {
      if (prev === undefined) delete process.env.STATS_CACHE_ENABLED
      else process.env.STATS_CACHE_ENABLED = prev
    }
  })

  it('GE-5 商品分类的 sort_order 索引模型与库一致', async () => {
    const [rows] = await sequelize.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'product_categories'
        AND schemaname = current_schema()
        AND indexname = 'idx_product_category_sort_order'
    `)
    expect(
      rows.length,
      '分类表缺 sort_order 索引 → 分类排序退化成全表扫（且模型不声明，新库又没有）'
    ).toBe(1)
  })

  it('GE-6 合作方商品列表不带用不上的 description', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '合作方测试分类', sort_order: 94 })
    await Product.create(TestDataFactory.createProduct({
      name: 'GE-6 商品',
      description: '这是一段很长的商品描述'.repeat(20),
      category_id: cat.id,
      status: 'active',
      stock: 5
    }))

    const { token } = await TestHelpers.createPartnerWithAddress()

    const res = await request(app)
      .get('/api/partner/products?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const list = res.body.data?.products || res.body.data || []
    const row = list.find(p => p.name === 'GE-6 商品')
    expect(row, '列表里应能找��这个商品').toBeTruthy()
    expect(
      row.description,
      '合作方端没用到商品描述，却整列带出来（TEXT 无长度上限）'
    ).toBeUndefined()
  })
})
