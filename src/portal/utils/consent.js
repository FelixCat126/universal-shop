/**
 * Cookie / 本地存储的同意状态（第 64 轮抽成共用工具）
 *
 * ## 为什么抽出来
 *
 * 之前"是否要显示告知横幅"的判断只写在 `CookieBanner.vue` 里。
 * 第 64 轮加了**手机端固定购买栏**（也固定在底部），
 * 两个 fixed 元素叠在一起 → 横幅会把购买栏**盖住**，客户点不到「加入购物车」。
 *
 * 解决办法：横幅显示时**购买栏让位**（不是靠 z-index 抢 —— 抢了会把
 * 横幅上那个「我知道了」按钮盖住，法律要求的告知入口就没了）。
 *
 * 所以两边必须知道同一件事 → 判断逻辑抽到一处。
 */
export const CONSENT_KEY = 'cookie_consent_at'

/** 同意事件名（横幅点了「我知道了」后广播，同页其它组件能立刻知道） */
export const CONSENT_ACCEPTED_EVENT = 'cookie-consent-accepted'

/**
 * 是否已经同意（= 告知横幅可以不再显示）。
 *
 * 存的是**时间戳**而不是布尔 —— 万一以后要改横幅文案或新增用途，
 * "什么时候同意的"比"同不同意过"更有用（GDPR 要求可证明同意时点）。
 */
export function hasCookieConsent () {
  try {
    return Boolean(localStorage.getItem(CONSENT_KEY))
  } catch {
    // 隐私模式 / 禁用存储 → 当作未同意，横幅会一直显示（这是安全侧的行为）
    return false
  }
}

/** 记录同意并广播 */
export function recordCookieConsent () {
  try {
    localStorage.setItem(CONSENT_KEY, new Date().toISOString())
  } catch {
    // 存不了也不该阻断用户（横幅只是告知）
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_ACCEPTED_EVENT))
  } catch {
    // 事件广播失败不影响同意状态本身
  }
}

/**
 * 监听"同意"事件。
 * @param {Function} cb
 * @returns {Function} 取消监听的函数
 */
export function onCookieConsentAccepted (cb) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CONSENT_ACCEPTED_EVENT, cb)
  return () => window.removeEventListener(CONSENT_ACCEPTED_EVENT, cb)
}
