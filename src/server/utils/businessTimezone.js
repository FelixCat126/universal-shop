/**
 * 业务时区（可配）：决定"今天 / 本地日历日"的边界
 *
 * ## 为什么要有它
 *
 * 之前所有"今天"都依赖**服务器进程的本地时区**（`new Date().setHours(0,0,0,0)`
 * 与 `AT TIME ZONE '<服务器偏移>'`）。这有两个问题：
 *
 * 1. **服务器换个时区，数字就变了**。"今日营收"没有跟着业务走，而是跟着机器走；
 * 2. **DST 时区上会自相矛盾**：固定偏移算出来的日分桶，
 *    与按本地日历日解析出来的日期筛选，在 DST 切换日会差一小时。
 *
 * 现在统一由 `business_timezone` 配置项决定（IANA 时区名，如 `Asia/Bangkok`），
 * 四处口径（统计日分桶 / 订单今日营收 / 用户统计 / 日期范围筛选）共用本模块，
 * 保证**同一个"今天"**。
 *
 * ## 时区名从哪来
 *
 * `system_configs.business_timezone`。取值必须能通过 `Intl.DateTimeFormat` 校验
 * （即真实的 IANA 时区名）—— 这同时挡掉了 SQL 注入：
 * 本模块会把时区名拼进 `AT TIME ZONE '...'`，而非法时区名一律被拒。
 *
 * ## 默认值
 *
 * `Asia/Shanghai`（UTC+8）：与现有生产服务器时区一致，
 * 升级后**数字不变**。若业务口径要按泰国时间，把配置改成 `Asia/Bangkok` 即可。
 */

import SystemConfig from '../models/SystemConfig.js'

/**
 * 业务时区默认值：**Asia/Bangkok**（泰国，UTC+7）。
 *
 * 为什么不是跟着服务器时区：
 *   - 服务器换机房/换云区，报表口径不该跟着变；
 *   - 店铺的**客户、计价货币（THB）、主要语言**都在泰国，
 *     「今天」应该按顾客的时钟切 —— 泰国时间 23:30 的单属于**泰国的那一天**，
 *     按中国时区算会被推到下一天，与平台的日结对不上。
 *
 * 运营可在管理端「系统配置 → 业务时区」随时改（改的是配置项，
 * 不是代码默认值），所以这里定的是**默认值**，不是不可改的规则。
 */
export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Bangkok'

/** 配置键名 */
export const BUSINESS_TIMEZONE_KEY = 'business_timezone'

/**
 * 合法时区名判定。
 *
 * 双重把关：
 *   1. 字符集白名单（IANA 名只含字母数字与 `_ + - /`）→ 挡掉引号等注入字符
 *   2. `Intl.DateTimeFormat` 能接受 → 确认是真实存在的时区
 */
export function isValidTimeZone (tz) {
  if (typeof tz !== 'string') return false
  const s = tz.trim()
  if (!s || !/^[A-Za-z0-9_+\-/]+$/.test(s)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s })
    return true
  } catch {
    return false
  }
}

/**
 * 读取当前生效的业务时区。
 *
 * 未配置 / 配置非法 → 回退默认值（**不让一条坏配置把统计整块搞挂**）。
 * SystemConfig.getConfig 自带 10s 进程内缓存，读一次不贵。
 */
export async function getBusinessTimezone () {
  try {
    const raw = await SystemConfig.getConfig(BUSINESS_TIMEZONE_KEY)
    const tz = typeof raw === 'string' ? raw.trim() : ''
    return isValidTimeZone(tz) ? tz : DEFAULT_BUSINESS_TIMEZONE
  } catch {
    return DEFAULT_BUSINESS_TIMEZONE
  }
}

/**
 * 某瞬间在给定时区下的 UTC 偏移（分钟，**东为正**）。
 *
 * 用 Intl 把该瞬间格式化成"墙上时间"，再和 UTC 比 —— 不依赖任何外部库，
 * 且 DST 会自动算对（每个瞬间单独求偏移）。
 */
export function tzOffsetMinutes (tz, date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = dtf.formatToParts(date)
  const get = (type) => {
    const p = parts.find(x => x.type === type)
    return p ? Number(p.value) : NaN
  }
  const asUTC = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second')
  )
  // 秒级精度足够（偏移都是整分钟）
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

/**
 * 某瞬间在给定时区下的日历日（{y, m, d}，m 从 1 开始）。
 */
export function localCalendarDate (tz, date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const parts = dtf.formatToParts(date)
  const get = (type) => {
    const p = parts.find(x => x.type === type)
    return p ? Number(p.value) : NaN
  }
  return { y: get('year'), m: get('month'), d: get('day') }
}

/**
 * 给定时区下某个日历日的 00:00:00.000 对应的 UTC 瞬间。
 *
 * 迭代两次求偏移（DST 切换日第一次的偏移可能不是最终值）。
 */
export function localDayStartUtc (tz, y, m, d) {
  const base = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
  let ts = base
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(tz, new Date(ts))
    const next = base - off * 60000
    if (next === ts) break
    ts = next
  }
  return new Date(ts)
}

/**
 * 给定时区下某个日历日的 23:59:59.999 对应的 UTC 瞬间。
 *
 * ⚠️ **不能**写成"起点 + 24h - 1ms"：夏令时切换日那天只有 23 小时（or 25 小时），
 * 用固定 24 小时会把当天的最后一小时算到下一天去（边界订单被漏掉/多算）。
 * 这里按当地 23:59:59.999 单独换算。
 */
export function localDayEndUtc (tz, y, m, d) {
  const base = Date.UTC(y, m - 1, d, 23, 59, 59, 999)
  let ts = base
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(tz, new Date(ts))
    const next = base - off * 60000
    if (next === ts) break
    ts = next
  }
  return new Date(ts)
}

/**
 * "今天"的起点（给定时区下当天的 00:00）。
 */
export function startOfBusinessDay (tz, now = new Date()) {
  const { y, m, d } = localCalendarDate(tz, now)
  return localDayStartUtc(tz, y, m, d)
}

/**
 * "今天"的终点（当天 23:59:59.999）。
 */
export function endOfBusinessDay (tz, now = new Date()) {
  const { y, m, d } = localCalendarDate(tz, now)
  return localDayEndUtc(tz, y, m, d)
}

/**
 * 日历日加减（不做时区换算，纯日历运算）。
 * 用 Date.UTC 做归一化，避免"31 号减 1 天"这类溢出问题。
 */
export function addDaysToCalendarDate (y, m, d, days) {
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/**
 * "N 天前"在该时区下的零点（用于趋势图的起始边界）。
 *
 * 与 JS 的 `setDate(getDate() - 7)` 等价，但按**业务时区的日历日**算，
 * 服务器时区变了也不会漂。
 */
export function businessDayStartDaysAgo (tz, now = new Date(), daysAgo = 7) {
  const cur = localCalendarDate(tz, now)
  const target = addDaysToCalendarDate(cur.y, cur.m, cur.d, -daysAgo)
  return localDayStartUtc(tz, target.y, target.m, target.d)
}

/**
 * 该瞬间在给定时区下的日历日键（'YYYY-MM-DD'）——
 * 与 SQL 侧 `DATE(created_at AT TIME ZONE '<tz>')` 的输出**逐字对齐**。
 */
export function localDateKey (tz, date = new Date()) {
  const { y, m, d } = localCalendarDate(tz, date)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 该时区下某个日历日键（'YYYY-MM-DD'）的起点/终点。
 *
 * 日期范围筛选用它把"用户选的那一天"翻译成 UTC 边界 ——
 * 用户看到的是业务时区的日历日，落库比较用的却是 UTC 瞬间。
 */
export function parseBusinessDayRange (tz, dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return {
    start: localDayStartUtc(tz, y, mo, d),
    end: localDayEndUtc(tz, y, mo, d)
  }
}

/**
 * 最近 N 天的日历日序列（**从旧到新**），用于趋势图补齐没有数据的那些天。
 *
 * @param {string} tz
 * @param {Date} [now]
 * @param {number} [days]
 * @returns {Array<{dateStr: string, date: Date}>}
 *   dateStr = 'YYYY-MM-DD'（与 SQL 分桶输出逐字对齐）
 *   date    = 该日历日的本地 Date（仅用于生成展示标签）
 */
export function businessDaySeries (tz, now = new Date(), days = 7) {
  const cur = localCalendarDate(tz, now)
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const target = addDaysToCalendarDate(cur.y, cur.m, cur.d, -i)
    const dateStr = `${target.y}-${String(target.m).padStart(2, '0')}-${String(target.d).padStart(2, '0')}`
    out.push({ dateStr, date: new Date(target.y, target.m - 1, target.d) })
  }
  return out
}

/**
 * 日粒度分桶的 SQL 表达式（按给定时区切日）。
 *
 * 用 `AT TIME ZONE '<IANA 名>'` 而不是固定偏移：
 * 固定偏移在 DST 时区上会**逐行算错**（同一列不同行可能落在不同的偏移上），
 * 而 IANA 名让 PG 自己按每一行的时间戳求正确偏移。
 *
 * 时区名已通过 isValidTimeZone 白名单校验（不含引号），拼进 SQL 安全。
 */
export function sqlDayBucket (tz, column = 'created_at') {
  const safe = isValidTimeZone(tz) ? tz.trim() : DEFAULT_BUSINESS_TIMEZONE
  return `${column} AT TIME ZONE '${safe}'`
}
