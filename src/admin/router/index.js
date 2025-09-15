import { createRouter, createWebHistory } from 'vue-router'
import { useAdminStore } from '../stores/admin.js'
import { ElMessage } from 'element-plus'

const router = createRouter({
  history: createWebHistory('/admin/'),  // 修复：明确指定base路径
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/Login.vue'),
      meta: { hideLayout: true, title: '管理员登录' }
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
          meta: { title: '产品管理', requiresAuth: true, permission: 'products' }
        },
        {
          path: '/orders',
          name: 'Orders',
          component: () => import('../views/Orders.vue'),
          meta: { title: '订单管理', requiresAuth: true, permission: 'orders' }
        },
        {
          path: '/users',
          name: 'Users',
          component: () => import('../views/Users.vue'),
          meta: { title: '用户管理', requiresAuth: true, permission: 'users' }
        },
        {
          path: '/operators',
          name: 'Operators',
          component: () => import('../views/Operators.vue'),
          meta: { title: '操作员管理', requiresAuth: true, permission: 'administrators' }
        },
        {
          path: '/operation-logs',
          name: 'OperationLogs',
          component: () => import('../views/OperationLogs.vue'),
          meta: { title: '操作日志', requiresAuth: true, requiresSuperAdmin: true }
        },
        {
          path: '/system-config',
          name: 'SystemConfig',
          component: () => import('../views/SystemConfig.vue'),
          meta: { title: '系统配置', requiresAuth: true, requiresSuperAdmin: true }
        }
      ]
    }
  ]
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const adminStore = useAdminStore()
  
  
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

export default router
