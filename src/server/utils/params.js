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
 * 严格解析整数：只接受「整数」或「纯数字字符串」，其余一律 null。
 *
 * 为什么不用 parseInt —— 它有两个静默吞值的坑：
 *   parseInt('1.5')   → 1    （小数被悄悄截断，库存少算/多算都难查）
 *   parseInt('10abc') → 10   （尾部脏字符被吞掉，脏输入被当成合法值）
 * 数量、库存这类字段必须**拒绝**这种情况，而不是替用户猜一个值。
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseStrictInt (value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null
  }
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
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
