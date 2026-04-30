import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import config from '../../config/index.js'

const TOKEN_KEY = 'partner_token'
const PROFILE_KEY = 'partner_profile'

function clearRetailAuth () {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export const usePartnerStore = defineStore('partner', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const profile = ref(null)
  const cart = ref([])

  /** 是否代理账号（影响 MOQ 与每单 SKU 上限） */
  function isAgentPartner () {
    return profile.value?.account_kind === 'agent'
  }

  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) profile.value = JSON.parse(raw)
  } catch {
    localStorage.removeItem(PROFILE_KEY)
  }

  const isLoggedIn = computed(() => !!token.value)

  function persistProfile (p) {
    profile.value = p
    if (p) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
    } else {
      localStorage.removeItem(PROFILE_KEY)
    }
  }

  function setToken (t) {
    token.value = t
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }

  async function api (path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    if (token.value) {
      headers.Authorization = `Bearer ${token.value}`
    }
    const normalized = path.startsWith('/') ? path : `/${path}`
    const url = config.buildApiUrl(`/api/partner${normalized}`)
    return fetch(url, { ...options, headers })
  }

  async function refreshProfile () {
    if (!token.value) return null
    try {
      const res = await api('/me')
      const json = await res.json()
      if (json.success && json.data) {
        persistProfile(json.data)
        return json.data
      }
    } catch {
      /* ignore */
    }
    return null
  }

  async function login (loginName, password) {
    clearRetailAuth()
    const res = await fetch(config.buildApiUrl('/api/partner/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginName, password })
    })
    const json = await res.json()
    if (!json.success) {
      return { success: false, message: json.message || '登录失败' }
    }
    setToken(json.data.token)
    persistProfile(json.data.partner)
    cart.value = []
    return { success: true }
  }

  function logout () {
    setToken('')
    persistProfile(null)
    cart.value = []
  }

  function addToCart (product, quantity) {
    if (isAgentPartner()) {
      const ids = new Set(cart.value.map((c) => c.product_id))
      if (!ids.has(product.id) && ids.size >= 3) {
        return { ok: false, code: 'AGENT_MAX_3_SKU' }
      }
    }
    const q = Math.floor(Number(quantity))
    if (!q || q < 1) return { ok: false, message: '数量无效' }
    const u = Math.max(1, Number(product.moq_unit) || 50)
    const m = Math.max(1, Number(product.moq_multiplier) || 1)
    if (q < u || (q - u) % m !== 0) {
      return { ok: false, message: `数量须从 ${u} 起，并按步长 ${m} 增加（当前下限 ${u}）` }
    }
    const existing = cart.value.find((c) => c.product_id === product.id)
    if (existing) {
      const nq = existing.quantity + q
      if (nq < u || (nq - u) % m !== 0) {
        return { ok: false, message: `合并后须从 ${u} 起且按步长 ${m} 调整` }
      }
      existing.quantity = nq
    } else {
      cart.value.push({
        product_id: product.id,
        name: product.name || '',
        image: product.image,
        unit_price_thb: product.unit_price_thb,
        moq_unit: u,
        moq_multiplier: m,
        quantity: q
      })
    }
    return { ok: true }
  }

  function removeFromCart (productId) {
    cart.value = cart.value.filter((c) => c.product_id !== productId)
  }

  function updateCartQty (line, quantity) {
    const u = Math.max(1, Number(line.moq_unit) || 50)
    const m = Math.max(1, Number(line.moq_multiplier) || 1)
    const q = Math.floor(Number(quantity))
    if (q < u || (q - u) % m !== 0) {
      return { ok: false, message: `须 ≥ ${u} 且步长 ${m}` }
    }
    line.quantity = q
    return { ok: true }
  }

  return {
    token,
    profile,
    cart,
    isLoggedIn,
    login,
    logout,
    api,
    addToCart,
    removeFromCart,
    updateCartQty,
    persistProfile,
    refreshProfile,
    isAgentPartner
  }
})
