import { Op } from 'sequelize'
import { isValidTimeZone, parseBusinessDayRange } from './businessTimezone.js'

/**
 * 规范化 yyyy-MM-dd，非法则返回 null
 */
export function sanitizeYmdInput (input) {
  if (input == null || input === '') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input).trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * 某个日历日的起点。
 *
 * @param {string} dateStr   'YYYY-MM-DD'
 * @param {string|null} [timezone] 业务时区（IANA 名）。
 *   给了 → 按**业务时区**的日历日算（用户看到的那一天）；
 *   不给 → 保持旧行为（服务器本地时区），供未接业务时区的调用方兼容。
 */
export function parseDayStart (dateStr, timezone = null) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  if (timezone && isValidTimeZone(timezone)) {
    const range = parseBusinessDayRange(timezone, dateStr.trim())
    return range ? range.start : null
  }
  const dt = new Date(y, mo, d, 0, 0, 0, 0)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/**
 * 某个日历日的终点（23:59:59.999）。timezone 语义同 parseDayStart。
 */
export function parseDayEnd (dateStr, timezone = null) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  if (timezone && isValidTimeZone(timezone)) {
    const range = parseBusinessDayRange(timezone, dateStr.trim())
    return range ? range.end : null
  }
  const dt = new Date(y, mo, d, 23, 59, 59, 999)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function bareColumnAttr (columnSpec) {
  if (!columnSpec.includes('.')) return columnSpec
  return columnSpec.slice(columnSpec.lastIndexOf('.') + 1).trim()
}

/**
 * created_from / created_to（或 start_date / end_date）按"日历日"筛选。
 * 已切换为 PostgreSQL：直接 Date + Op.gte/Op.lte，由 PG 处理 timestamptz。
 *
 * @param {object} options
 * @param {string} [options.column] 时间字段（模型属性名），默认 created_at
 * @param {string} [options.timezone] 业务时区（IANA 名）：日历日按它切，
 *   不给则沿用服务器本地时区（兼容旧调用方）
 */
export function applyCreatedBetween (whereBase, reqQuery, options = {}) {
  const fromRaw = reqQuery.created_from ?? reqQuery.start_date
  const toRaw = reqQuery.created_to ?? reqQuery.end_date
  const fm = sanitizeYmdInput(fromRaw)
  const tm = sanitizeYmdInput(toRaw)
  if (!fm && !tm) return whereBase

  const columnSpec = typeof options.column === 'string' && options.column.trim() ? options.column.trim() : 'created_at'
  const columnAttr = bareColumnAttr(columnSpec)

  const range = {}
  const tz = typeof options.timezone === 'string' && options.timezone.trim()
    ? options.timezone.trim()
    : null
  if (fm) {
    const a = parseDayStart(fm, tz)
    if (a) range[Op.gte] = a
  }
  if (tm) {
    const c = parseDayEnd(tm, tz)
    if (c) range[Op.lte] = c
  }
  if (Reflect.ownKeys(range).length === 0) return whereBase
  return {
    ...whereBase,
    [columnAttr]: range
  }
}
