/**
 * VS-Cart — 购物车 Pinia Store
 *   覆盖：
 *     CS-1 itemCount/totalAmount/isEmpty 计算属性
 *     CS-2 游客 addToCart → push items + 写 localStorage
 *     CS-3 游客 addToCart 库存不足 → success:false
 *     CS-4 已登录 addToCart 走 api.post('/cart')
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
})
