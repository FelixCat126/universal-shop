/**
 * 列表页滚动位置记忆（第 42 轮）
 * ============================
 *
 * ## 为什么需要
 *
 * 实测（浏览器）：在商品列表滚到第 3 屏（scrollY=627）→ 点进详情 → 点「返回」
 * → **回到 scrollY=294**（位置丢了一半）。
 *
 * 这是电商/后台最常见的路径之一：
 *   列表翻到某处 → 点进详情 → 返回 → 本该接着逛
 * 结果每次返回都要重新往下滚 —— 反复发生时非常打断节奏。
 *
 * 浏览器自带的 `scrollBehavior` 的 `savedPosition` 只在**浏览器前进/后退**时有效；
 * 应用内"点返回"走的是 `router.push`，拿不到 savedPosition → 位置丢失。
 *
 * ## 做法
 *
 * 离开列表页时把 scrollY 记到 sessionStorage（会话级，关标签页即失效），
 * 回到该路由时在**渲染完成之后**恢复。
 *
 * 为什么要等渲染完成：内容还没渲染时页面高度不足，
 * `scrollTo` 会被截断到当前可滚动高度 → 恢复不到位。
 *
 * ## 只对需要的路由生效
 *
 * 由路由 meta 决定：`meta: { keepScroll: true }`。
 * 详情页、结算页这类"从上一步来"的页面**不该**恢复（用户要看到顶部）。
 */

/** sessionStorage 不可用时（隐私模式/SSR）降级为内存 Map */
const memory = new Map()
let storageOk = null

function getStore () {
  if (storageOk === null) {
    try {
      const k = '__scroll_probe__'
      window.sessionStorage.setItem(k, '1')
      window.sessionStorage.removeItem(k)
      storageOk = true
    } catch {
      storageOk = false
    }
  }
  return storageOk
}

function key (routeKey) {
  return `scroll:${routeKey}`
}

/**
 * 记住某个路由的滚动位置。
 * @param {string} routeKey 路由标识（一般用 fullPath）
 * @param {number} y scrollY
 */
export function rememberScroll (routeKey, y) {
  if (!routeKey) return
  const value = Math.max(0, Math.round(Number(y) || 0))
  if (getStore()) {
    try {
      window.sessionStorage.setItem(key(routeKey), String(value))
      return
    } catch { /* 存不下就退到内存 */ }
  }
  memory.set(routeKey, value)
}

/**
 * 读取记住的滚动位置。
 * @param {string} routeKey
 * @returns {number}
 */
export function recallScroll (routeKey) {
  if (!routeKey) return 0
  if (getStore()) {
    try {
      const raw = window.sessionStorage.getItem(key(routeKey))
      if (raw != null) return Math.max(0, Number(raw) || 0)
    } catch { /* ignore */ }
  }
  return memory.get(routeKey) || 0
}

/**
 * 清除某个路由记住的位置（用于"重置筛选"这类场景）。
 * @param {string} routeKey
 */
export function forgetScroll (routeKey) {
  if (!routeKey) return
  if (getStore()) {
    try { window.sessionStorage.removeItem(key(routeKey)) } catch { /* ignore */ }
  }
  memory.delete(routeKey)
}

/**
 * 在**渲染完成之后**恢复到记住的位置。
 *
 * 等两帧：Vue 更新 DOM → 浏览器完成布局 → 此时页面高度才够 scrollTo。
 * @param {string} routeKey
 */
export function restoreScroll (routeKey) {
  const y = recallScroll(routeKey)
  if (!y) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.scrollTo({ top: y, behavior: 'auto' })
      } catch {
        window.scrollTo(0, y)
      }
    })
  })
}

/**
 * 是否处于"刚恢复滚动位置"的窗口内。
 *
 * ## 为什么需要
 *
 * 返回列表页时，页面刚渲染、内容高度还不够（无限滚动的列表只加载了第一页），
 * 恢复位置的那一刻，底部哨兵可能已经在视口内 → **无限滚动被误触发**
 * → 立刻又加载一页 → 用户看到"列表怎么多了一倍商品"。
 *
 * 恢复窗口内抑制自动加载，用户继续往下滚时会正常加载。
 *
 * @param {number} [windowMs] 窗口长度（默认 1200ms）
 */
let lastRestoreAt = 0

export function markRestored () {
  lastRestoreAt = Date.now()
}

export function inRestoreWindow (windowMs = 1200) {
  if (!lastRestoreAt) return false
  return Date.now() - lastRestoreAt < windowMs
}
