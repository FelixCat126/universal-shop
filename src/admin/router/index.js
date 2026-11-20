import { createRouter, createWebHistory } from 'vue-router'
import { rememberScroll, restoreScroll, markRestored } from '../../shared/scrollMemory.js'
import { useAdminStore } from '../stores/admin.js'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL || '/'),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/Login.vue'),
      meta: { hideLayout: true, title: '管理员登录' }
    },
    {
      // 修改本人密码：强制改密期间**不带布局**（此时其他页面都用不了）
      path: '/password',
      name: 'Password',
      component: () => import('../views/Password.vue'),
      meta: { hideLayout: true, title: '修改密码', requiresAuth: true }
    },
    {
      path: '/',
      name: 'Layout',
      component: () => import('../components/Layout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: '/dashboard',
          name: 'Dashboard',
          component: () => import('../views/Dashboard.vue'),
          meta: { title: '统计总览', requiresAuth: true }
        },
        {
          path: '/products',
          name: 'Products',
          component: () => import('../views/Products.vue'),
          meta: { title: '产品管理', requiresAuth: true, permission: 'products', keepScroll: true }
        },
        {
          path: '/product-categories',
          name: 'ProductCategories',
          component: () => import('../views/ProductCategories.vue'),
          meta: { title: '类别管理', requiresAuth: true, permission: 'products', keepScroll: true }
        },
        {
          path: '/promotions',
          name: 'Promotions',
          component: () => import('../views/Promotions.vue'),
          meta: { title: '促销管理', requiresAuth: true, permission: 'products', keepScroll: true }
        },
        {
          path: '/bundles',
          name: 'Bundles',
          component: () => import('../views/Bundles.vue'),
          meta: { title: '组合套餐', requiresAuth: true, permission: 'products', keepScroll: true }
        },
        {
          path: '/coupon-templates',
          name: 'CouponTemplates',
          component: () => import('../views/CouponTemplates.vue'),
          meta: { title: '抵扣券管理', requiresAuth: true, permission: 'products', keepScroll: true }
        },
        {
          path: '/orders',
          name: 'Orders',
          component: () => import('../views/Orders.vue'),
          meta: { title: '订单管理', requiresAuth: true, permission: 'orders', keepScroll: true }
        },
        {
          // 售后单（第 45 轮补上管理端入口）：
          // 后端接口一直都在，但管理端没有页面 → 用户提交的售后单没人看得到、审不了。
          path: '/after-sales',
          name: 'AfterSales',
          component: () => import('../views/AfterSales.vue'),
          meta: { title: '售后管理', requiresAuth: true, permission: 'orders', keepScroll: true }
        },
        {
          path: '/users',
          name: 'Users',
          component: () => import('../views/Users.vue'),
          meta: { title: '用户管理', requiresAuth: true, permission: 'users', keepScroll: true }
        },
        {
          path: '/partners',
          name: 'Partners',
          component: () => import('../views/Partners.vue'),
          meta: { title: '合作方账号', requiresAuth: true, permission: 'partners', keepScroll: true }
        },
        {
          path: '/partner-orders',
          name: 'PartnerOrders',
          component: () => import('../views/PartnerOrders.vue'),
          meta: { title: '合作方订单', requiresAuth: true, permission: 'partners', keepScroll: true }
        },
        {
          path: '/operators',
          name: 'Operators',
          component: () => import('../views/Operators.vue'),
          meta: { title: '操作员管理', requiresAuth: true, permission: 'administrators', keepScroll: true }
        },
        {
          path: '/operation-logs',
          name: 'OperationLogs',
          component: () => import('../views/OperationLogs.vue'),
          meta: { title: '操作日志', requiresAuth: true, requiresSuperAdmin: true, keepScroll: true }
        },
        {
          path: '/system-config',
          name: 'SystemConfig',
          component: () => import('../views/SystemConfig.vue'),
          meta: { title: '系统配置', requiresAuth: true, requiresSuperAdmin: true }
        }
      ]
    },
    // 兜底 404：不挂 requiresAuth，未登录访问未知路径也直接展示 404 而不是跳登录页
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../views/NotFound.vue'),
      meta: { title: '404', hideLayout: true }
    }
  ]
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const adminStore = useAdminStore()

  // vite dev 下 base 为 /，但仍可能打开书签里的 /admin/xxx；剥掉前缀统一到应用内路径
  const baseUrl = import.meta.env.BASE_URL || '/'
  if (baseUrl === '/' && to.path.startsWith('/admin')) {
    let suffix = to.path.slice('/admin'.length)
    if (!suffix || suffix === '/') suffix = '/'
    else if (!suffix.startsWith('/')) suffix = `/${suffix}`
    next({ path: suffix, query: to.query, hash: to.hash, replace: true })
    return
  }

  /**
   * 强制改密：后台账号仍在用默认口令时，**除改密页外一律跳走**。
   * 服务端也会拦（adminAuthMiddleware 的 PASSWORD_CHANGE_REQUIRED），
   * 这里只是让用户不必去点一个必然 403 的按钮。
   */
  if (adminStore.isLoggedIn && adminStore.mustResetPassword && to.name !== 'Password') {
    next({ name: 'Password', replace: true })
    return
  }

  // 如果是登录页面，且已经登录，跳转到首页
  if (to.name === 'Login' && adminStore.isLoggedIn) {
    next('/dashboard')
    return
  }
  
  // 如果是登录页面，直接放行
  if (to.name === 'Login') {
    next()
    return
  }
  
  // 如果需要认证但未登录，跳转到登录页
  if (to.meta.requiresAuth && !adminStore.isLoggedIn) {
    next('/login')
    return
  }
  
  // 如果访问根路径且未登录，跳转到登录页
  if (to.path === '/' && !adminStore.isLoggedIn) {
    next('/login')
    return
  }
  
  // 如果需要超级管理员权限
  if (to.meta.requiresSuperAdmin && !adminStore.isSuperAdmin) {
    ElMessage.error('需要超级管理员权限')
    next(false)
    return
  }
  
  // 如果需要特定权限
  if (to.meta.permission && !adminStore.hasPermission(to.meta.permission)) {
    ElMessage.error('权限不足')
    next(false)
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
