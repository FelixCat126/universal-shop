/**
 * 业务时区工具层测试
 *
 * 这层是"今天"的唯一真相源 —— 报表分桶、订单今日营收、日期筛选都用它。
 * 算错了不会报错，只会让数字悄悄偏一天，所以必须逐条钉死。
 *
 *   BT-1 时区名校验：只接受真实 IANA 名（挡 SQL 注入）
 *   BT-2 偏移计算：固定偏移 + 夏令时两种时区都对
 *   BT-3 日边界：本地 00:00 ↔ UTC 瞬间的换算
 *   BT-4 日历日加减不溢出（31 号减 1 天 = 上月最后一天）
 *   BT-5 7 天序列：从旧到新、末位是今天
 *   BT-6 SQL 分桶表达式：用 IANA 名而不是固定偏移
 *   BT-7 配置读取：未配置/非法配置 → 回退默认；合法配置 → 生效
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_BUSINESS_TIMEZONE,
  isValidTimeZone,
  getBusinessTimezone,
  tzOffsetMinutes,
  localCalendarDate,
  localDayStartUtc,
  localDayEndUtc,
  startOfBusinessDay,
  endOfBusinessDay,
  addDaysToCalendarDate,
  businessDayStartDaysAgo,
  businessDaySeries,
  sqlDayBucket
} from '@server/utils/businessTimezone.js'
import { TestDatabase } from '../setup/test-database.js'
import SystemConfig from '@server/models/SystemConfig.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('业务时区工具层', () => {
  it('BT-1 时区名校验：只接受真实 IANA 名', () => {
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)

    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(null)).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    // SQL 注入尝试：引号 / 分号 / 空格都必须被拒
    expect(isValidTimeZone("Asia/Bangkok'; DROP TABLE orders; --")).toBe(false)
    expect(isValidTimeZone('Asia/Bangkok OR 1=1')).toBe(false)
    expect(isValidTimeZone('Asia/Bangkok, UTC')).toBe(false)
  })

  it('BT-2 偏移计算：固定偏移与夏令时都对', () => {
    const jan = new Date('2026-01-15T12:00:00Z')
    const jul = new Date('2026-07-15T12:00:00Z')

    // 无夏令时的固定偏移时区
    expect(tzOffsetMinutes('Asia/Shanghai', jan)).toBe(480)   // UTC+8
    expect(tzOffsetMinutes('Asia/Bangkok', jan)).toBe(420)    // UTC+7
    expect(tzOffsetMinutes('UTC', jan)).toBe(0)

    // 有夏令时的时区：同一个时区，冬夏偏移不同
    expect(tzOffsetMinutes('America/New_York', jan)).toBe(-300)  // EST
    expect(tzOffsetMinutes('America/New_York', jul)).toBe(-240)  // EDT
  })

  it('BT-3 日边界：本地 00:00 ↔ UTC 瞬间的换算', () => {
    // 曼谷 UTC+7：2026-03-10 本地 00:00 = 2026-03-09T17:00:00Z
    const start = localDayStartUtc('Asia/Bangkok', 2026, 3, 10)
    expect(start.toISOString()).toBe('2026-03-09T17:00:00.000Z')

    // 上海 UTC+8：2026-03-10 本地 00:00 = 2026-03-09T16:00:00Z
    const start2 = localDayStartUtc('Asia/Shanghai', 2026, 3, 10)
    expect(start2.toISOString()).toBe('2026-03-09T16:00:00.000Z')

    // 终点 = 起点 + 一天 - 1ms
    const end = localDayEndUtc('Asia/Bangkok', 2026, 3, 10)
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000 - 1)

    // 夏令时切换日：本地那天只有 23 小时（2026-03-08 美东）
    const dstStart = localDayStartUtc('America/New_York', 2026, 3, 8)
    const dstEnd = localDayEndUtc('America/New_York', 2026, 3, 8)
    expect(dstEnd.getTime() - dstStart.getTime()).toBe(23 * 3600 * 1000 - 1)
  })

  it('BT-4 日历日加减不溢出', () => {
    expect(addDaysToCalendarDate(2026, 3, 31, -1)).toEqual({ y: 2026, m: 3, d: 30 })
    expect(addDaysToCalendarDate(2026, 3, 1, -1)).toEqual({ y: 2026, m: 2, d: 28 })
    expect(addDaysToCalendarDate(2026, 1, 1, -1)).toEqual({ y: 2025, m: 12, d: 31 })
    expect(addDaysToCalendarDate(2026, 12, 31, 1)).toEqual({ y: 2027, m: 1, d: 1 })
    expect(addDaysToCalendarDate(2024, 3, 1, -1)).toEqual({ y: 2024, m: 2, d: 29 }) // 闰年
  })

  it('BT-5 7 天序列：从旧到新、末位是今天', () => {
    const now = new Date('2026-03-15T02:00:00Z')   // 曼谷时间当天 09:00
    const series = businessDaySeries('Asia/Bangkok', now, 7)
    expect(series.length).toBe(7)
    expect(series[6].dateStr).toBe('2026-03-15')
    expect(series[0].dateStr).toBe('2026-03-09')
    // 严格递增
    for (let i = 1; i < series.length; i++) {
      expect(series[i].dateStr > series[i - 1].dateStr).toBe(true)
    }
  })

  it('BT-6 SQL 分桶表达式用 IANA 名（不是固定偏移）', () => {
    expect(sqlDayBucket('Asia/Bangkok')).toBe("created_at AT TIME ZONE 'Asia/Bangkok'")
    // 非法时区名 → 落回默认，不把脏值拼进 SQL
    expect(sqlDayBucket("x'; DROP TABLE orders; --")).toBe(
      `created_at AT TIME ZONE '${DEFAULT_BUSINESS_TIMEZONE}'`
    )
  })

  it('BT-7 配置读取：未配置/非法 → 默认；合法 → 生效', async () => {
    // 未配置
    expect(await getBusinessTimezone()).toBe(DEFAULT_BUSINESS_TIMEZONE)

    // 非法配置 → 仍然回默认（不让一条坏配置把统计搞挂）
    await SystemConfig.setConfig('business_timezone', 'Not/AZone', 'text', '坏值')
    expect(await getBusinessTimezone()).toBe(DEFAULT_BUSINESS_TIMEZONE)

    // 合法配置 → 生效
    await SystemConfig.setConfig('business_timezone', 'Asia/Bangkok', 'text', '业务时区')
    expect(await getBusinessTimezone()).toBe('Asia/Bangkok')

    // 校���日期也随之改变
    const now = new Date('2026-03-15T20:00:00Z')
    expect(localCalendarDate('Asia/Bangkok', now)).toEqual({ y: 2026, m: 3, d: 16 })
    expect(localCalendarDate('Asia/Shanghai', now)).toEqual({ y: 2026, m: 3, d: 16 })
    // 而上海此刻已是 16 日 04:00；曼谷 16 日 03:00 —— 同一天
    expect(startOfBusinessDay('Asia/Bangkok', now).toISOString())
      .toBe('2026-03-15T17:00:00.000Z')
    expect(endOfBusinessDay('Asia/Bangkok', now).toISOString())
      .toBe('2026-03-16T16:59:59.999Z')
  })
})
