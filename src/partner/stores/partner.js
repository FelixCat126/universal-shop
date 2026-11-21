/**
 * @typedef {import('../../types/api').Partner} Partner
 * @typedef {import('../../types/api').PartnerOrder} PartnerOrder
 * @typedef {import('../../types/api').PartnerAddress} PartnerAddress
 * @typedef {import('../../types/api').PartnerOrderItem} PartnerOrderItem
 * @typedef {import('../../types/api').PartnerOrderWithItems} PartnerOrderWithItems
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import config from '../../config/index.js'
import i18n from '../i18n/index.js'

/**
 * 合作方端的文案要走 i18n —— 之前这些提示全是**硬编码中文**
 * （MOQ / 库存 / 数量非法），英文与泰文用户看到的是中文。
 */
const t = (key, params) => i18n.global.t(key, params || {})

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
    const res = await fetch(url, { ...options, headers })
    if (res.status === 401 || res.status === 403) {
      /**
       * 401 = token 过期/无效；**403 = 账号被运营禁用**（partnerAuthMiddleware 返回
       * "合作方账号不可用"）。
       *
       * 之前只处理 401 → 账号被禁用后，前端只在某一次请求弹个 toast，
       * **人还停在旧页面上**，看着像"系统没反应"（其他接口全 403）。
       * 两种情况都该直接登出 + 回登录页。
       */
      logout()
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = `${import.meta.env.BASE_URL || '/'}login`
      }
    }
    return res
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

  async function login (loginName, password, captcha) {
    clearRetailAuth()
    try {
      const body = { login: loginName, password }
      if (captcha && captcha.token) {
        body.captcha_token = captcha.token
        body.captcha_answer = Math.round(Number(captcha.answer) || 0)
      }
      const res = await fetch(config.buildApiUrl('/api/partner/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const json = await res.json().catch(() => null)
      // 失败次数过多触发滑块验证：把 code 透传给视图层
      if (res.status === 428) {
        return { success: false, code: json?.code || 'CAPTCHA_REQUIRED', message: json?.message || '' }
      }
      if (!json || !json.success) {
        return { success: false, message: (json && json.message) || '登录失败' }
      }
      setToken(json.data.token)
      persistProfile(json.data.partner)
      cart.value = []
      return { success: true }
    } catch (error) {
      // 网络异常等：记录日志并返回空 message，由调用方用 i18n 文案提示
      console.error('[partner] login failed:', error)
      return { success: false, message: '' }
    }
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
    if (!q || q < 1) return { ok: false, message: t('shop.qtyInvalid') }
    // 数量不得超过库存（否则界面金额失真；服务端仍会兜底拒绝）
    const stock = Number(product.stock)
    if (Number.isFinite(stock) && stock > 0 && q > stock) {
      return { ok: false, message: t('shop.stockExceeded', { count: stock }) }
    }
    const u = Math.max(1, Number(product.moq_unit) || 50)
    const m = Math.max(1, Number(product.moq_multiplier) || 1)
    if (q < u || (q - u) % m !== 0) {
      return { ok: false, message: t('shop.moqWarn', { unit: u, step: m }) }
    }
    const existing = cart.value.find((c) => c.product_id === product.id)
    if (existing) {
      const nq = existing.quantity + q
      if (nq < u || (nq - u) % m !== 0) {
        return { ok: false, message: t('shop.moqMerged', { unit: u, step: m }) }
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

  /**
   * 改清单行的数量（MOQ 起订量 / 步长约束）。
   *
   * ⚠️ 非法值必须**回写**回去。
   * 输入框是 v-model 直接绑在 line.quantity 上的，用户改完的瞬间
   * 非法值已经进了 store —— 之前这里只 return 不回写，于是：
   *   1) 侧栏「预估合计」按非法数量算（金额显示错）；
   *   2) 点「提交订单」把非法数量发给后端 → 400 起订量错误，
   *      用户填了半天白填，而且报错文案和前端提示对不上。
   * 所以校验不通过时把数量**拉回最近的合法值**（起订量），
   * 界面与提交内容始终一致。
   */
  function updateCartQty (line, quantity) {
    const u = Math.max(1, Number(line.moq_unit) || 50)
    const m = Math.max(1, Number(line.moq_multiplier) || 1)
    const q = Math.floor(Number(quantity))
    if (!Number.isFinite(q) || q < 1) {
      line.quantity = u
      return { ok: false, message: t('shop.qtyInvalidReset', { unit: u }) }
    }
    if (q < u || (q - u) % m !== 0) {
      line.quantity = u
      return { ok: false, message: t('shop.moqReset', { unit: u, step: m }) }
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
    /**
     * 换 token —— 改密后服务端会发新的（token_version 自增 → 旧 token 立即失效），
     * 必须对外暴露，否则改密成功后当前会话会自己把自己踢下线。
     */
    setToken,
    addToCart,
    removeFromCart,
    updateCartQty,
    persistProfile,
    refreshProfile,
    isAgentPartner
  }
})
