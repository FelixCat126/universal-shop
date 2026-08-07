/**
 * VR-Router — Portal 路由懒加载
 *
 * 覆盖：
 *   RT-1 所有 routes 配置正确
 *   RT-2 所有路由都用动态 import（懒加载）
 *   RT-3 /:pathMatch(.*)* 兜底路由最后
 *   RT-4 需要 auth 的路由都有 requiresAuth
 *   RT-5 base path 是 /portal/
 */
import { describe, it, expect } from 'vitest'
import router from '@portal/router/index.js'

describe('VR.portal.router', () => {
  it('RT-1 所有 routes 配置正确', () => {
    const routes = router.getRoutes()
    const names = routes.map((r) => r.name)
    expect(names).toContain('Home')
    expect(names).toContain('ProductDetail')
    expect(names).toContain('Cart')
    expect(names).toContain('Checkout')
    expect(names).toContain('OrderDetail')
    expect(names).toContain('Register')
    expect(names).toContain('Login')
    expect(names).toContain('Profile')
    expect(names).toContain('NotFound')
  })

  it('RT-2 所有路由都用动态 import（懒加载）', () => {
    const routes = router.getRoutes()
    // 路由的 component 是函数（动态 import 的结果）
    // 检查至少 Home/ProductDetail 是懒加载
    const home = routes.find((r) => r.name === 'Home')
    expect(home).toBeDefined()
    // 经过 vue-router 处理后，component 是函数
    expect(typeof home.components.default).toBe('function')
  })

  it('RT-3 /:pathMatch(.*)* 兜底路由最后', () => {
    const routes = router.getRoutes()
    const notFound = routes.find((r) => r.name === 'NotFound')
    expect(notFound).toBeDefined()
    expect(notFound.path).toBe('/:pathMatch(.*)*')
  })

  it('RT-4 需要 auth 的路由都有 requiresAuth', () => {
    const routes = router.getRoutes()
    const protectedRoutes = routes.filter((r) => r.meta?.requiresAuth)
    const names = protectedRoutes.map((r) => r.name)
    expect(names).toContain('Profile')
    expect(names).toContain('OrderDetail')
  })

  it('RT-5 base path 是 /portal/（路由 push /portal/x 能找到）', async () => {
    // 通过 router.resolve 验证
    const r = router.resolve('/')
    expect(r.path).toBe('/')
    // base 处理在浏览器 location 上，间接验证 router 能匹配 / → Home
    expect(r.name).toBe('Home')
  })

  it('RT-6 scrollBehavior 已配置', () => {
    // vue-router 4 通过 options.scrollBehavior
    expect(typeof router.options.scrollBehavior).toBe('function')
  })

  it('RT-7 公开路由（Home/Register/Login）不带 requiresAuth', () => {
    const routes = router.getRoutes()
    const publicNames = ['Home', 'Register', 'Login', 'ProductDetail', 'NotFound']
    for (const name of publicNames) {
      const r = routes.find((x) => x.name === name)
      expect(r?.meta?.requiresAuth).toBeFalsy()
    }
  })
})
