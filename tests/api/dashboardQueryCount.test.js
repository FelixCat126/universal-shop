/**
 * 仪表盘查询条数护栏 —— 防止"每个数字一条 count"的写法回潮
 *
 * ## 背景
 *
 * 优化前，总览数据方法发 **10 条查询**：总数、营收、总用户、活跃用户、今日统计、
 * 待办四个数各一条 —— 其中 orders 表被**全表扫了 5 遍**。
 *
 * 这些数字可以用一条查询里的多个 FILTER 聚合一次算出来（口径完全不变），
 * 优化后是 **6 条查询**（含一次读时区配置），orders 表只扫 3 遍。
 *
 * ## 为什么用查询条数当护栏
 *
 * 数字对不对有别的用例断言；这里守的是**形状**：
 * "又多写了一条 count" 是最容易犯、也最容易被忽略的性能退化。
 * 阈值留了余量（≤8），但不允许悄悄回到"每个数字一条"。
 *
 *   DQ-1 总览数据方法的查询条数不超过 8
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { sequelize } from '@server/models/index.js'
import StatisticsController from '@server/controllers/statisticsController.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('仪表盘查询条数', () => {
  it('DQ-1 总览数据方法的查询条数不超过 8（优化后是 6）', async () => {
    const orig = sequelize.query.bind(sequelize)
    let count = 0
    sequelize.query = (...args) => { count++; return orig(...args) }
    try {
      await StatisticsController.getOverviewStatsData()
    } finally {
      sequelize.query = orig
    }
    expect(
      count,
      `总览数据方法发了 ${count} 条查询（上限 8）—— 每个数字一条 count 的写法回来了`
    ).toBeLessThanOrEqual(8)
  })
})
