import { createRouter, createWebHistory } from 'vue-router'
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

function reloadOnceForChunk () {
  if (chunkReloaded) return
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
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
  next()
})

export default router
