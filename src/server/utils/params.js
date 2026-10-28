/**
 * 路由参数解析工具
 *
 * 背景：req.params.id 是字符串，直接交给 Sequelize 会拼进 SQL：
 *   Order.findByPk('abc') → PG 报 invalid input syntax for type integer → 500
 * 非法路径参数应返回 400（客户端错误），而不是 500（服务端故障）。
 */

/**
 * 解析正整数 ID，非法返回 null
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseId (value) {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  if (!/^\d+$/.test(str)) return null
  const n = Number(str)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return n
}

/**
 * 解析日期（ISO 字符串或时间戳），非法返回 null
 * @param {unknown} value
 * @returns {Date|null}
 */
export function parseDate (value) {
  if (value === undefined || value === null || value === '') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * 校验并夹取分页参数
 * @param {unknown} value
 * @param {number} def
 * @param {number} max
 */
export function parsePositiveInt (value, def, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(Math.floor(n), max)
}
