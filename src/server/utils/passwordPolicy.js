/**
 * 用户自助设置的密码：至少 8 位，须同时含英文字母与数字（区分大小写）；允许常见特殊字符。
 * 游客/订单自动注册等系统生成的密码不参与此规则。
 */
export function assertPasswordPolicy (password) {
  const s = String(password ?? '')
  if (!s) {
    return { ok: false, message: '请输入密码' }
  }
  if (s.length < 8) {
    return { ok: false, message: '密码至少8个字符' }
  }
  if (!/[0-9]/.test(s)) {
    return { ok: false, message: '密码须包含至少一个数字' }
  }
  if (!/[A-Za-z]/.test(s)) {
    return { ok: false, message: '密码须包含至少一个英文字母' }
  }
  return { ok: true }
}
