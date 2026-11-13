/**
 * 登录后跳转目标的安全校验
 *
 * redirect 参数完全来自 URL query，若不校验就 router.push：
 *   - '//evil.com'  → 协议相对地址，可能被解析为外站
 *   - 'https://evil.com' → 绝对外链
 *   - 数组形式 (?redirect[]=x) → 行为不确定
 *
 * 只接受「站内绝对路径」：以单个 / 开头、不以 // 开头、且与当前 origin 同源。
 */

/**
 * @param {unknown} target 待跳转目标
 * @param {string} fallback 非法时的回落路径
 * @returns {string} 安全的站内路径
 */
export function safeRedirectPath (target, fallback = '/') {
  if (typeof target !== 'string') return fallback
  const t = target.trim()
  if (!t) return fallback
  // 必须以单个 / 开头（站内绝对路径），排除 // 与 /\ 之类的协议相对写法
  if (!t.startsWith('/') || t.startsWith('//') || t.startsWith('/\\')) return fallback
  // 反斜杠也可能被浏览器当作协议分隔符
  if (t.includes('\\')) return fallback
  try {
    const url = new URL(t, window.location.origin)
    if (url.origin !== window.location.origin) return fallback
    // 只保留路径与查询，不带 hash 之外的任何外部信息
    const result = `${url.pathname}${url.search}${url.hash}`
    /**
     * ⚠️ 必须对**归一化之后**的结果再检一次。
     *
     * `new URL('/..//evil.com', origin)` 会把 `..` 归一化掉 →
     * pathname 变成 `//evil.com`（authority 藏在 pathname 里）。
     * 而 `url.origin` 只看 scheme/host/port，**发现不了**这种形态 ——
     * 上面那几行 startsWith('//') 的判断发生在归一化**之前**，挡不住。
     *
     * 后果：登录后 router.push('//evil.com') → 落到 404 而不是目标页；
     * 若将来把这个返回值接到 window.location，就是真正的开放重定向。
     */
    if (result.startsWith('//') || result.startsWith('/\\')) return fallback
    return result
  } catch {
    return fallback
  }
}
