import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory('/portal/'),  // 修复：添加base路径
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
      path: '/profile',
      name: 'Profile',
      component: () => import('../views/Profile.vue'),
      meta: { title: '个人中心', requiresAuth: true }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../views/NotFound.vue'),
      meta: { title: '页面未找到' }
    }
  ]
})

// 路由守卫
router.beforeEach((to, from, next) => {
  // 设置页面标题
  if (to.meta.title) {
    document.title = to.meta.title + ' - Universal Shop'
  }

  // 检查是否需要认证
  if (to.meta.requiresAuth) {
    const token = localStorage.getItem('token')
    if (!token) {
      next('/login')
      return
    }
  }

  next()
})

export default router
