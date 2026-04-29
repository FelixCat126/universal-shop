import { Op } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 规范化 yyyy-MM-dd，非法则返回 null（仅用于 SQLite 中与 strftime 结果比较）
 */
export function sanitizeYmdInput (input) {
  if (input == null || input === '') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input).trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * @deprecated 仅用非 SQLite方言；SQLite 日历筛选见 applyCreatedBetween
 */
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

/**
 * created_from / created_to（或 start_date / end_date）与「日历日」一致。
 * SQLite：用 strftime('%Y-%m-%d', created_at) 与 yyyy-MM-DD 字符串比较，避免与时区 Timestamp 手写 Date 偏移导致漏筛选。
 * 其它方言：沿用 Date + Op.gte/Op.lte。
 *
 * @param {string} [options.column] 时间字段（模型属性名），默认 created_at。
 *   SQLite 若在 JOIN 后列名混淆，可写成 `主模型别名.created_at`，如 `PointTransaction.created_at`，会生成 `"PointTransaction"."created_at"`。
 */
function bareColumnAttr (columnSpec) {
  if (!columnSpec.includes('.')) return columnSpec
  return columnSpec.slice(columnSpec.lastIndexOf('.') + 1).trim()
}

function sqliteDatetimeExprQuoted (columnSpec) {
  const esc = (id) => `"${String(id).replace(/"/g, '""')}"`
  if (columnSpec.includes('.')) {
    const dot = columnSpec.lastIndexOf('.')
    const table = columnSpec.slice(0, dot).trim()
    const col = columnSpec.slice(dot + 1).trim()
    return `${esc(table)}.${esc(col)}`
  }
  return esc(columnSpec)
}

export function applyCreatedBetween (whereBase, reqQuery, options = {}) {
  const fromRaw = reqQuery.created_from ?? reqQuery.start_date
  const toRaw = reqQuery.created_to ?? reqQuery.end_date
  const fm = sanitizeYmdInput(fromRaw)
  const tm = sanitizeYmdInput(toRaw)
  if (!fm && !tm) return whereBase

  const columnSpec = typeof options.column === 'string' && options.column.trim() ? options.column.trim() : 'created_at'
  const columnAttr = bareColumnAttr(columnSpec)

  if (sequelize.getDialect() === 'sqlite') {
    const colExpr = sqliteDatetimeExprQuoted(columnSpec)
    /** @type {string[]} */
    const parts = []
    if (fm) {
      parts.push(`strftime('%Y-%m-%d', ${colExpr}) >= ${sequelize.escape(fm)}`)
    }
    if (tm) {
      parts.push(`strftime('%Y-%m-%d', ${colExpr}) <= ${sequelize.escape(tm)}`)
    }
    if (parts.length === 0) return whereBase

    const literalExpr = sequelize.literal(parts.join(' AND '))

    const merged = { ...whereBase }
    const prev = merged[Op.and]
    delete merged[Op.and]

    return {
      ...merged,
      [Op.and]: [...(Array.isArray(prev) ? prev : prev ? [prev] : []), literalExpr]
    }
  }

  /** 默认：与其它数据库驱动一致 */
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
