/**
 * 路由 chunk 预取（第 37 轮）
 *
 * ## 为什么需要
 *
 * 所有页面都是动态 import（懒加载）。第一次进入某页时要**下载那个页面的 chunk**，
 * 期间路由已经切换、但新页面还没渲染 → 用户看到的是一段**空白**，
 * 体感就是"页面卡了一下 / 在刷新"。
 *
 * 本地网络快时这段空窗只有几十毫秒，生产上（真实网络 + 缓存未命中）
 * 可能是几百毫秒到数秒 —— 正是用户说的"切换页面时的跳动"。
 *
 * ## 做法
 *
 * 用户**把鼠标移到链接上**（或手指按下）时，就把那个路由的组件 chunk 下载好。
 * 等他真正点下去时，import 已经命中缓存 → 立即渲染 → 没有空窗。
 *
 * 用**事件委托**挂在 document 上，而不是给每个 router-link 加 @mouseenter：
 *   - 零侵入（新增页面不用记得加）
 *   - 覆盖所有链接（包括动态生成的）
 *
 * 触屏没有 hover → 额外监听 touchstart 预取。
 */
import { onMounted, onBeforeUnmount } from 'vue'

/** 已经预取过的路由（避免重复触发 import） */
const prefetched = new Set()

/**
 * 预取某个路由的组件 chunk。
 * @param {object} route vue-router 解析出的 route 对象
 */
export function prefetchRoute (route) {
  if (!route || typeof route.component !== 'function') return
  const key = route.path
  if (prefetched.has(key)) return
  prefetched.add(key)
  try {
    const p = route.component()
    // 预取失败不能影响正常导航（例如 chunk 404）
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* 忽略 */
  }
}

/**
 * 在应用里启用预取。
 * @param {import('vue-router').Router} router
 */
export function useRoutePrefetch (router) {
  let lastHref = null
  let lastAt = 0

  const resolveTarget = (href) => {
    if (!href || href.startsWith('http') || href.startsWith('#')) return null
    try {
      return router.resolve(href)
    } catch {
      return null
    }
  }

  const onPointer = (e) => {
    const el = e.target instanceof Element ? e.target.closest('a[href]') : null
    if (!el) return
    const href = el.getAttribute('href')
    if (!href) return
    // 同一链接 1 秒内只处理一次（mouseover 会高频触发）
    const now = Date.now()
    if (href === lastHref && now - lastAt < 1000) return
    lastHref = href
    lastAt = now
    const target = resolveTarget(href)
    if (!target) return
    // 取最深匹配的那个记录（带 params 的动态路由）
    const matched = target.matched
    if (matched.length) prefetchRoute(matched[matched.length - 1])
  }

  const onTouch = (e) => {
    const el = e.target instanceof Element ? e.target.closest('a[href]') : null
    if (!el) return
    const target = resolveTarget(el.getAttribute('href'))
    if (!target) return
    const matched = target.matched
    if (matched.length) prefetchRoute(matched[matched.length - 1])
  }

  onMounted(() => {
    document.addEventListener('mouseover', onPointer, { passive: true })
    document.addEventListener('touchstart', onTouch, { passive: true })
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mouseover', onPointer)
    document.removeEventListener('touchstart', onTouch)
  })
}

/**
 * 按**路由名**预取（比按路径更稳：带 params 的动态路由路径每次都不一样）。
 * @param {import('vue-router').Router} router
 * @param {string} name 路由 name
 */
export function prefetchRouteByName (router, name) {
  if (!router || !name) return
  const target = router.getRoutes().find(r => r.name === name)
  if (target) prefetchRoute(target)
}

/**
 * 在**浏览器空闲时**预取若干路由。
 *
 * 为什么需要它：事件委托只能覆盖 <a href> 的链接，而商品卡这类是
 * `<div @click="goToDetail(id)">` —— 鼠标移上去时没有链接可挂，
 * 事件委托抓不到 → 预取形同虚设。
 * 空闲时预取高频目的地（详情页是零售端最高频的下一页）才能覆盖这类跳转。
 *
 * @param {import('vue-router').Router} router
 * @param {string[]} names 路由名数组
 */
export function prefetchRoutesWhenIdle (router, names) {
  const run = () => {
    for (const n of names) prefetchRouteByName(router, n)
  }
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 2000 })
  } else {
    setTimeout(run, 600)
  }
}
