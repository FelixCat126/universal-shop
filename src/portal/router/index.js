import { createRouter, createWebHistory } from 'vue-router'
import { rememberScroll, restoreScroll, markRestored } from '../../shared/scrollMemory.js'
import i18n from '../i18n'

const router = createRouter({
  history: createWebHistory('/portal/'),  // 修复：添加base路径
  /* 路由切换时回到顶部；从二级页返回时保持滚动位置 */
  scrollBehavior (to, from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0, behavior: 'smooth' }
  },
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('../views/Home.vue'),
      meta: { title: '商城首页', keepScroll: true }
    },
    {
      path: '/products/:id',
      name: 'ProductDetail',
      component: () => import('../views/product/ProductDetail.vue'),
      meta: { title: '商品详情' }
    },
    {
      path: '/cart',
      name: 'Cart',
      component: () => import('../views/cart/Cart.vue'),
      meta: { title: '购物车', keepScroll: true }
    },
    {
      path: '/checkout',
      name: 'Checkout',
      component: () => import('../views/cart/Checkout.vue'),
      meta: { title: '订单确认' }
    },
    {
      path: '/orders/:id',
      name: 'OrderDetail',
      component: () => import('../views/order/OrderDetail.vue'),
      meta: { title: '订单详情', requiresAuth: true }
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('../views/Register.vue'),
      meta: { title: '用户注册' }
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/Login.vue'),
      meta: { title: '用户登录' }
    },
    {
      path: '/forgot-password',
      name: 'ForgotPassword',
      component: () => import('../views/ForgotPassword.vue'),
      meta: { title: '找回密码' }
    },
    {
      path: '/profile',
      name: 'Profile',
      component: () => import('../views/Profile.vue'),
      meta: { title: '个人中心', requiresAuth: true }
    },
    {
      // 站内通知（第 54 轮）：独立页面（Profile 的 tab 已有 6 个，再加会更挤）
      path: '/notifications',
      name: 'Notifications',
      component: () => import('../views/Notifications.vue'),
      meta: { title: '我的通知', requiresAuth: true }
    },
    {
      path: '/privacy',
      name: 'Privacy',
      component: () => import('../views/LegalPage.vue'),
      props: { kind: 'privacy' },
      meta: { title: '隐私政策' }
    },
    {
      path: '/terms',
      name: 'Terms',
      component: () => import('../views/LegalPage.vue'),
      props: { kind: 'terms' },
      meta: { title: '用户协议' }
    },
    {
      // 退换货政策（第 54 轮）：可商用商城的必备页面 ——
      // 原来只有「用户协议」里一句"退款退货以订单记录为准"，没有可执行的政策。
      path: '/returns',
      name: 'Returns',
      component: () => import('../views/LegalPage.vue'),
      props: { kind: 'returns' },
      meta: { title: '退换货政策' }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../views/NotFound.vue'),
      meta: { titleKey: 'error.notFound' }
    }
  ]
})

// 路由守卫
router.beforeEach((to, from, next) => {
  // 设置页面标题：优先 i18n key（titleKey），向后兼容硬编码 title
  if (to.meta.titleKey) {
    document.title = i18n.global.t(to.meta.titleKey) + ' - Universal Shop'
  } else if (to.meta.title) {
    document.title = to.meta.title + ' - Universal Shop'
  }

  // 检查是否需要认证
  if (to.meta.requiresAuth) {
    const token = localStorage.getItem('token')
    if (!token) {
      next('/login')
      return
    }
    /**
     * token 明显不是 JWT（不是三段 base64url）→ 直接判为无效并清理。
     * 真实有效性由 userStore.checkAuth() 调 /auth/verify 确认（App 挂载时执行），
     * 守卫里不再发请求，避免每次导航都等网络。
     */
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      next('/login')
      return
    }
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
