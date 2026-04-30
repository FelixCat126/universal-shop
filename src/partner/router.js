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
    { path: '/', redirect: '/shop' }
  ]
})

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
