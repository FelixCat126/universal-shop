import { createRouter, createWebHistory } from 'vue-router'
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
      meta: { title: '商城首页' }
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
      meta: { title: '购物车' }
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

export default router
