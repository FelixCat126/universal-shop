/**
 * LIKE 模式构造与转义
 *
 * 问题：用户输入的 `%` / `_` 未转义直接拼进 `%${input}%`，
 * 攻击者用 `keyword=%` 就能把"精确筛选"放大成全表扫描 + 全量返回
 * （参数化查询，不构成 SQL 注入，但会造成查询放大与数据越界暴露）。
 *
 * 解决：转义 LIKE 通配符，并配套声明 ESCAPE '\'。
 */

/** LIKE 模式中的特殊字符 */
const LIKE_SPECIALS = /[\\%_]/g

/**
 * 转义 LIKE 模式里的通配符
 * @param {unknown} value 用户输入
 * @returns {string} 转义后的字面量
 */
export function escapeLike (value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(LIKE_SPECIALS, (ch) => `\\${ch}`)
}

/**
 * 构造「包含」匹配的模式（已转义）
 * @param {unknown} value
 * @returns {string} 形如 %keyword%
 */
export function likeContains (value) {
  return `%${escapeLike(value)}%`
}
