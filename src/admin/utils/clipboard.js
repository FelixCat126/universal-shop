/**
 * 剪贴板复制（第 60 轮 · 操作便利性）
 * =================================
 *
 * ## 为什么要有这一层
 *
 * 运营每天要复制的是**订单号**（粘到快递系统下单）和**物流单号**（发给客户）。
 * 订单号是 22 位大小写混排（`ORD1779468118144DP4KV7`），
 * 手动框选复制**很容易看错**（O/0、l/1、V/U），抄错了要退回快递系统改一遍。
 *
 * ## 为什么不用 `navigator.clipboard` 直接写
 *
 * 1. 它需要**安全上下文**（https 或 localhost）。管理端在生产是 https ✓，
 *    但内网 http 访问时会直接抛 `undefined is not a function`。
 * 2. 它需要**用户手势 + 权限**，被浏览器策略拒绝时是 Promise reject。
 * 3. 非安全上下文下没有它 —— 所以这里留一条 `execCommand` 的兜底。
 *
 * 返回 boolean 而不是抛错：调用方只需要知道"成功没成功"，
 * 成功给个提示、失败给个提示，两条路都不该把业务流程打断。
 */

/**
 * 复制文本到剪贴板。
 * @param {string} text
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyText (text) {
  const value = String(text ?? '')
  if (!value) return false

  // ① 现代 API
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // 权限被拒 / 非安全上下文 → 走兜底
  }

  // ② 兜底：execCommand（已废弃，但没别的办法时能用）
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
