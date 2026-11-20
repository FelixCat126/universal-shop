/**
 * VS-Cart — 购物车 Pinia Store
 *   覆盖：
 *     CS-1 itemCount/totalAmount/isEmpty 计算属性
 *     CS-2 游客 addToCart → push items + 写 localStorage
 *     CS-3 游客 addToCart 库存不足 → success:false
 *     CS-4 已登录 addToCart 走 api.post('/cart')
 *     CS-4b 已登录 addToCart 乐观更新（不等服务端就进列表）
 *     CS-4c/4d 服务端失败或抛错 → 回滚乐观项
 *     CS-5 updateQuantity 0 → 调用 removeFromCart
 *     CS-6 clearCart 已登录 → api.delete('/cart')
 *     CS-7 mergeGuestCartOnLogin 把 localStorage 中商品逐个 POST + 全成功后清空
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 必须在 import store 之前 mock api 与 user store
vi.mock('@portal/api/index.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}))

vi.mock('@portal/stores/user.js', () => {
  let _logged = false
  return {
    useUserStore: () => ({
      get isLoggedIn () { return _logged },
      __setLogged (v) { _logged = v }
    })
  }
})

const apiModule = await import('@portal/api/index.js')
const api = apiModule.default
const { useUserStore } = await import('@portal/stores/user.js')
const { useCartStore } = await import('@portal/stores/cart.js')

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  api.get.mockReset()
  api.post.mockReset()
  api.put.mockReset()
  api.delete.mockReset()
  useUserStore().__setLogged(false)
})

describe('VS.store.cart', () => {
  it('CS-1 计算属性', () => {
    const c = useCartStore()
    c.items = [
      { id: 1, product_id: 1, quantity: 2, price: 10 },
      { id: 2, product_id: 2, quantity: 3, price: 5 }
    ]
    expect(c.itemCount).toBe(5)
    expect(c.totalAmount).toBe(35)
    expect(c.isEmpty).toBe(false)
    c.items = []
    expect(c.isEmpty).toBe(true)
  })

  it('CS-2 游客 addToCart → push + localStorage', async () => {
    const c = useCartStore()
    const product = { id: 1, price: 100, stock: 10 }
    const r = await c.addToCart(product, 2)
    expect(r.success).toBe(true)
    expect(c.items.length).toBe(1)
    expect(c.items[0].quantity).toBe(2)
    expect(JSON.parse(localStorage.getItem('guest_cart')).length).toBe(1)
  })

  it('CS-3 游客库存不足 → success:false', async () => {
    const c = useCartStore()
    const r = await c.addToCart({ id: 1, price: 10, stock: 1 }, 5)
    expect(r.success).toBe(false)
    expect(r.message).toBe('stockInsufficientSimple')
  })

  it('CS-4 已登录 addToCart 走 api.post', async () => {
    useUserStore().__setLogged(true)
    api.post.mockResolvedValue({ data: { success: true, data: { id: 99 } } })
    const c = useCartStore()
    const r = await c.addToCart({ id: 1, price: 10, stock: 5 }, 1)
    expect(r.success).toBe(true)
    expect(api.post).toHaveBeenCalledWith('/cart', { product_id: 1, quantity: 1 })
    expect(c.items[0].id).toBe(99)
  })

  it('CS-4b 已登录 addToCart 是乐观更新：请求未回就已经出现在列表里', async () => {
    useUserStore().__setLogged(true)
    let resolvePost
    api.post.mockImplementation(() => new Promise(resolve => { resolvePost = resolve }))
    const c = useCartStore()

    const p = c.addToCart({ id: 1, price: 10, stock: 5 }, 1)
    // 服务端还没回，商品已经进列表了（角标/列表立刻变化）
    expect(c.items.length).toBe(1)
    expect(c.items[0].optimistic).toBe(true)

    resolvePost({ data: { success: true, data: { id: 77 } } })
    await p
    // 服务端回来后换成真实 id，乐观标记去掉
    expect(c.items.length).toBe(1)
    expect(c.items[0].id).toBe(77)
    expect(c.items[0].optimistic).toBeUndefined()
  })

  it('CS-4c 服务端失败 → 回滚乐观加入的商品', async () => {
    useUserStore().__setLogged(true)
    api.post.mockResolvedValue({ data: { success: false } })
    const c = useCartStore()
    const r = await c.addToCart({ id: 1, price: 10, stock: 5 }, 1)
    expect(r.success).toBe(false)
    expect(c.items.length).toBe(0) // 回滚了，不会留下幽灵商品
  })

  it('CS-4d 请求抛错 → 同样回滚', async () => {
    useUserStore().__setLogged(true)
    api.post.mockRejectedValue(new Error('network'))
    const c = useCartStore()
    const r = await c.addToCart({ id: 1, price: 10, stock: 5 }, 1)
    expect(r.success).toBe(false)
    expect(c.items.length).toBe(0)
  })

  it('CS-5 updateQuantity(0) → 走 remove 分支', async () => {
    const c = useCartStore()
    await c.addToCart({ id: 1, price: 10, stock: 5 }, 1)
    const itemId = c.items[0].id
    const r = await c.updateQuantity(itemId, 0)
    expect(r.success).toBe(true)
    expect(c.items.length).toBe(0)
  })

  it('CS-6 clearCart 已登录 → api.delete', async () => {
    useUserStore().__setLogged(true)
    api.delete.mockResolvedValue({ data: { success: true } })
    const c = useCartStore()
    c.items = [{ id: 1, product_id: 1, quantity: 1, price: 10 }]
    const r = await c.clearCart()
    expect(r.success).toBe(true)
    expect(api.delete).toHaveBeenCalledWith('/cart')
    expect(c.items.length).toBe(0)
  })

  it('CS-7 mergeGuestCartOnLogin 把 localStorage 商品逐项 POST', async () => {
    useUserStore().__setLogged(true)
    localStorage.setItem(
      'guest_cart',
      JSON.stringify([
        { id: 'guest_a', product_id: 1, product: { id: 1, price: 10, stock: 10 }, quantity: 2, price: 10 },
        { id: 'guest_b', product_id: 2, product: { id: 2, price: 5, stock: 10 }, quantity: 1, price: 5 }
      ])
    )
    api.post.mockResolvedValue({ data: { success: true, data: { id: 100 } } })
    api.get.mockResolvedValue({ data: { success: true, data: [] } })
    const c = useCartStore()
    const r = await c.mergeGuestCartOnLogin()
    expect(r.success).toBe(true)
    expect(api.post).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('guest_cart')).toBeNull()
  })

  /**
   * 第 43 轮：下架商品（status = 'inactive'）在购物车里必须算**失效**。
   *
   * 背景：公开列表/详情已经不再返回下架商品，下单也会拦（400）。
   * 唯独购物车没管 → 用户把下架商品留在车里，点「去结算」才被拦，白走一趟。
   *
   * 断言三件事：
   *   1. 标记 unavailable（前端会禁用「去结算」并显示提示）
   *   2. 标记 offShelf（前端据此显示"已下架"）
   *   3. 不计入总价（失效行不参与金额计算）
   */
  it('CS-8 loadCart：下架商品被标记失效且不计入总价', async () => {
    useUserStore().__setLogged(true)
    api.get.mockResolvedValue({
      data: {
        success: true,
        data: [
          { id: 1, product_id: 1, quantity: 1, product: { id: 1, name: '在售', price: 100, stock: 5, status: 'active' } },
          { id: 2, product_id: 2, quantity: 2, product: { id: 2, name: '已下架', price: 50, stock: 5, status: 'inactive' } }
        ]
      }
    })
    const c = useCartStore()
    await c.loadCart()
    expect(c.items.length).toBe(2)
    const off = c.items.find(i => i.product_id === 2)
    expect(off.unavailable, '下架商品必须标记失效').toBe(true)
    expect(off.offShelf, '下架商品必须带 offShelf 标记（前端据此显示已下架）').toBe(true)
    expect(off.product?.name, '失效时要保留商品名，用户才知道要删哪一件').toBe('已下架')
    expect(c.totalAmount, '失效行不参与总价').toBe(100)
  })
})
