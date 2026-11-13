/**
 * 密码策略 —— 前端侧的**唯一真相源**。
 *
 * 与后端 `src/server/utils/passwordPolicy.js` 的 `assertPasswordPolicy`
 * **逐条对齐**（≥8 位 + 至少一个数字 + 至少一个英文字母）。
 *
 * 为什么放共享层：
 * 以前门户自带一份副本、管理端又用另一套更松的规则（≥6 字符），
 * 三份规则各说各话 → 用户在前端过了、后端拒（"前端过了后端拒"的错位）。
 * 现在只有这一份，改一处三端同时生效。
 *
 * ⚠️ 后端改了规则，**这里必须同步改** ——
 * `tests/vue/passwordPolicyParity.test.js` 会比对两边源码并让 CI 变红。
 */
export const PASSWORD_MIN_LEN = 8

/**
 * @returns {null | 'short' | 'digit' | 'letter'} 通过返回 null；空串返回 null（由调用方提示必填）
 */
export function describePasswordPolicyFailure (password) {
  const s = String(password ?? '')
  if (!s) return null
  if (s.length < PASSWORD_MIN_LEN) return 'short'
  if (!/[0-9]/.test(s)) return 'digit'
  if (!/[A-Za-z]/.test(s)) return 'letter'
  return null
}

/** 通过返回 true */
export function meetsPasswordPolicy (password) {
  return describePasswordPolicyFailure(password) === null
}
