import { createRouter, createWebHistory } from 'vue-router'
import { rememberScroll, restoreScroll, markRestored } from '../shared/scrollMemory.js'
import { usePartnerStore } from './stores/partner.js'

const router = createRouter({
  history: createWebHistory('/partner/'),
  routes: [
    {
      path: '/login',
      name: 'PartnerLogin',
      component: () => import('./views/Login.vue'),
      meta: { public: true }
    },
    {
      path: '/shop',
      name: 'PartnerShop',
      component: () => import('./views/Shop.vue')
    },
    {
      path: '/addresses',
      name: 'PartnerAddresses',
      component: () => import('./views/Addresses.vue')
    },
    {
      path: '/orders',
      name: 'PartnerOrders',
      component: () => import('./views/Orders.vue')
    },
    {
      path: '/password',
      name: 'PartnerPassword',
      component: () => import('./views/Password.vue')
    },
    { path: '/', redirect: '/shop' },
    {
      // 不带 meta.public：未登录访问未知路径仍由守卫跳登录，已登录才显示 404
      path: '/:pathMatch(.*)*',
      name: 'PartnerNotFound',
      component: () => import('./views/NotFound.vue')
    }
  ]
})

const CHUNK_RELOAD_KEY = 'partner-chunk-reload'
let chunkReloaded = false

function isChunkLoadError (error) {
  const msg = String((error && error.message) || error || '')
  return /dynamically imported module|module script failed|error loading chunk|vite:preloadError/i.test(msg)
}

/**
 * chunk 加载失败时刷新一次拿新版本。
 *
 * 失败后再失败（chunk 真的缺失）时**不能静默吞掉** ——
 * 早期实现第二次直接 return，页面停在空 router-view，
 * 永久白屏且控制台没有任何错误线索。
 */
function reloadOnceForChunk () {
  if (chunkReloaded) {
    // 已刷新过一次仍失败：明确报错，不再静默
    console.error('[partner-router] chunk 加载失败且已刷新过一次，停止自动刷新（请检查静态资源部署是否完整）')
    return
  }
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      console.error('[partner-router] chunk 加载失败且已刷新过一次，停止自动刷新（请检查静态资源部署是否完整）')
      return
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    /* sessionStorage 不可用时靠内存标记兜底 */
  }
  chunkReloaded = true
  window.location.reload()
}

router.onError((error) => {
  if (isChunkLoadError(error)) {
    reloadOnceForChunk()
  } else {
    console.error('[partner-router] navigation error:', error)
  }
})

// 导航成功即清除重载标记，避免影响后续正常的 chunk 失败重试
router.afterEach(() => {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    /* ignore */
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnceForChunk()
  })
}

router.beforeEach((to, from, next) => {
  const store = usePartnerStore()
  if (!to.meta.public && !store.token) {
    next({ path: '/login', query: { redirect: to.fullPath } })
    return
  }
  if (to.name === 'PartnerLogin' && store.token) {
    next('/shop')
    return
  }
  /**
   * 强制改密：账号是运营用初始口令建的（CSV 批量导入 / 管理端重置），
   * 在换成自己的密码之前只能停在改密页 —— 服务端也会拦，这里是前端的第一道。
   */
  if (store.token && store.profile?.must_reset_password && to.name !== 'PartnerPassword') {
    next({ path: '/password' })
    return
  }
  next()
})

/**
 * 滚动位置记忆（第 42 轮）：列表页 → 详情页 → 返回时，位置回到离开前的地方。
 * 只对 meta.keepScroll 的路由生效（详情/结算页不恢复，用户要看到顶部）。
 */
router.beforeEach((to, from) => {
  if (from.meta && from.meta.keepScroll) {
    rememberScroll(from.fullPath, window.scrollY)
  }
  return true
})

router.afterEach((to) => {
  if (to.meta && to.meta.keepScroll) {
    // 先标记"刚恢复"，让列表页的无限滚动在恢复窗口内不要自动加载下一页
    markRestored()
    restoreScroll(to.fullPath)
  }
})

export default router
