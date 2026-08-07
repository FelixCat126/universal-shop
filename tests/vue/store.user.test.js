/**
 * VS-User — 用户 Pinia Store
 *
 * 覆盖：
 *   US-1 初始未登录
 *   US-2 setAuth 写 localStorage
 *   US-3 clearAuth 清 localStorage + partner_token
 *   US-4 checkAuth 有 token 调 /auth/verify
 *   US-5 checkAuth 401 时 clearAuth
 *   US-6 login 成功 setAuth
 *   US-7 login 失败返回 success:false
 *   US-8 register 成功 setAuth
 *   US-9 logout 调 /auth/logout + clearAuth
 *   US-10 updateProfile 更新 user + localStorage
 *   US-11 verifyReferralCode 调 /auth/verify-referral
 *   US-12 isAdmin 计算属性（role=admin）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@portal/api/index.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}))

const apiModule = await import('@portal/api/index.js')
const api = apiModule.default
const { useUserStore } = await import('@portal/stores/user.js')

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  api.get.mockReset()
  api.post.mockReset()
  api.put.mockReset()
  api.delete.mockReset()
})

describe('VS.store.user', () => {
  it('US-1 初始未登录', () => {
    const u = useUserStore()
    expect(u.isAuthenticated).toBe(false)
    expect(u.isLoggedIn).toBe(false)
  })

  it('US-2 setAuth 写 localStorage', () => {
    const u = useUserStore()
    u.setAuth({ id: 1, nickname: 'X' }, 'tok123')
    expect(localStorage.getItem('token')).toBe('tok123')
    expect(JSON.parse(localStorage.getItem('user'))).toEqual({ id: 1, nickname: 'X' })
    expect(u.isAuthenticated).toBe(true)
  })

  it('US-3 clearAuth 清 localStorage + partner_token', () => {
    localStorage.setItem('partner_token', 'p1')
    localStorage.setItem('partner_profile', '{}')
    const u = useUserStore()
    u.setAuth({ id: 1 }, 'tok')
    u.clearAuth()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
    expect(localStorage.getItem('partner_token')).toBeNull()
    expect(localStorage.getItem('partner_profile')).toBeNull()
    expect(u.isAuthenticated).toBe(false)
  })

  it('US-4 checkAuth 有 token 调 /auth/verify', async () => {
    localStorage.setItem('token', 'tok123')
    localStorage.setItem('user', JSON.stringify({ id: 1, nickname: 'A' }))
    api.get.mockResolvedValue({ data: { success: true, data: { user: { id: 1, nickname: 'A' } } } })
    const u = useUserStore()
    await u.checkAuth()
    expect(api.get).toHaveBeenCalledWith('/auth/verify')
  })

  it('US-5 checkAuth 401 时 clearAuth', async () => {
    localStorage.setItem('token', 'tok123')
    localStorage.setItem('user', JSON.stringify({ id: 1 }))
    api.get.mockRejectedValue(new Error('401'))
    const u = useUserStore()
    await u.checkAuth()
    expect(localStorage.getItem('token')).toBeNull()
    expect(u.isAuthenticated).toBe(false)
  })

  it('US-6 login 成功 setAuth', async () => {
    api.post.mockResolvedValue({
      data: { success: true, data: { user: { id: 1, nickname: 'B' }, token: 'newTok' } }
    })
    const u = useUserStore()
    const r = await u.login({ phone: '13800000000', password: 'x' })
    expect(r.success).toBe(true)
    expect(u.token).toBe('newTok')
    expect(u.user.nickname).toBe('B')
  })

  it('US-7 login 失败返回 success:false', async () => {
    api.post.mockRejectedValue({
      response: { data: { message: '用户名或密码错误' } }
    })
    const u = useUserStore()
    const r = await u.login({ phone: '13800000000', password: 'wrong' })
    expect(r.success).toBe(false)
    expect(r.message).toBe('用户名或密码错误')
  })

  it('US-8 register 成功 setAuth', async () => {
    api.post.mockResolvedValue({
      data: { success: true, data: { user: { id: 2 }, token: 'regTok' } }
    })
    const u = useUserStore()
    const r = await u.register({ nickname: 'X', phone: '13800000000', password: 'x' })
    expect(r.success).toBe(true)
    expect(u.token).toBe('regTok')
  })

  it('US-9 logout 调 /auth/logout + clearAuth', async () => {
    const u = useUserStore()
    u.setAuth({ id: 1 }, 'tok')
    api.post.mockResolvedValue({ data: { success: true } })
    await u.logout()
    expect(api.post).toHaveBeenCalledWith('/auth/logout')
    expect(u.isAuthenticated).toBe(false)
  })

  it('US-10 updateProfile 更新 user + localStorage', async () => {
    const u = useUserStore()
    u.setAuth({ id: 1, nickname: 'old' }, 'tok')
    api.put.mockResolvedValue({
      data: { success: true, data: { nickname: 'new' } }
    })
    const r = await u.updateProfile({ nickname: 'new' })
    expect(r.success).toBe(true)
    expect(u.user.nickname).toBe('new')
    expect(JSON.parse(localStorage.getItem('user')).nickname).toBe('new')
  })

  it('US-11 verifyReferralCode 调 /auth/verify-referral', async () => {
    api.get.mockResolvedValue({ data: { success: true } })
    const u = useUserStore()
    await u.verifyReferralCode('ABC123')
    expect(api.get).toHaveBeenCalledWith('/auth/verify-referral/ABC123')
  })

  it('US-12 isAdmin 计算属性', () => {
    const u = useUserStore()
    expect(u.isAdmin).toBe(false)
    u.setAuth({ id: 1, role: 'admin' }, 'tok')
    expect(u.isAdmin).toBe(true)
  })
})
