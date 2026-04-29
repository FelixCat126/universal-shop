/** 与后端 assertPasswordPolicy 一致的门户校验（自助设置密码场景） */
export const PASSWORD_MIN_LEN = 8

/** @returns {null | 'short' | 'digit' | 'letter'} 空串用 null（由调用方提示必填） */
export function describePasswordPolicyFailure (password) {
  const s = String(password ?? '')
  if (!s) return null
  if (s.length < PASSWORD_MIN_LEN) return 'short'
  if (!/[0-9]/.test(s)) return 'digit'
  if (!/[A-Za-z]/.test(s)) return 'letter'
  return null
}
