import { Op } from 'sequelize'

/**
 * 规范化 yyyy-MM-dd，非法则返回 null
 */
export function sanitizeYmdInput (input) {
  if (input == null || input === '') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input).trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function parseDayStart (dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const dt = new Date(y, mo, d, 0, 0, 0, 0)
  return Number.isNaN(dt.getTime()) ? null : dt
}

export function parseDayEnd (dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
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
  if (fm) {
    const a = parseDayStart(fm)
    if (a) range[Op.gte] = a
  }
  if (tm) {
    const c = parseDayEnd(tm)
    if (c) range[Op.lte] = c
  }
  if (Object.keys(range).length === 0) return whereBase
  return {
    ...whereBase,
    [columnAttr]: range
  }
}
