import { defineStore } from 'pinia'
import { ref } from 'vue'
import config from '../../config/index.js'
import { PORTAL_CURRENCIES, formatConvertedMoney, convertThbToCurrency } from '../../utils/exchangeRatesDisplay.js'

const STORAGE_KEY = 'portal_currency'

/** 与语言首次绑定的默认展示币种 */
export const DEFAULT_CURRENCY_BY_LOCALE = {
  'zh-CN': 'CNY',
  'en-US': 'USD',
  'th-TH': 'THB'
}

const VALID = new Set(['THB', 'USD', 'CNY', 'MYR'])

export const usePortalCurrencyStore = defineStore('portalCurrency', () => {
  const selectedCode = ref('THB')
  const rates = ref({ USD: '0.00', CNY: '0.00', MYR: '0.00' })
  const loaded = ref(false)

  const options = PORTAL_CURRENCIES

  const labelFor = (code) => PORTAL_CURRENCIES.find((c) => c.code === code)?.label ?? code

  async function loadRates () {
    try {
      const response = await fetch(config.buildApiUrl('/api/system-config/public'))
      if (!response.ok) return
      const data = await response.json()
      const er = data.data?.exchange_rates
      if (er && typeof er === 'object') {
        rates.value = {
          USD: er.USD ?? '0.00',
          CNY: er.CNY ?? '0.00',
          MYR: er.MYR ?? '0.00'
        }
      }
    } catch (e) {
      console.warn('portalCurrency: load rates failed', e)
    } finally {
      loaded.value = true
    }
  }

  function defaultForLocale (locale) {
    return DEFAULT_CURRENCY_BY_LOCALE[locale] || 'THB'
  }

  /** 切换界面语言时：按业务规则同步默认币种（会覆盖当前选择） */
  function applyDefaultForLocale (locale) {
    const d = defaultForLocale(locale)
    selectedCode.value = d
    try {
      localStorage.setItem(STORAGE_KEY, d)
    } catch (_) {}
  }

  function setCurrency (code) {
    const c = String(code || '').toUpperCase()
    if (!VALID.has(c)) return
    selectedCode.value = c
    try {
      localStorage.setItem(STORAGE_KEY, c)
    } catch (_) {}
  }

  /** 应用启动：有合法缓存则尊重用户上次选择，否则跟语言默认 */
  function initFromStorage (locale) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw && VALID.has(raw)) {
        selectedCode.value = raw
        return
      }
    } catch (_) {}
    applyDefaultForLocale(locale)
  }

  function formatThb (thbAmount) {
    return formatConvertedMoney(thbAmount, selectedCode.value, rates.value)
  }

  function convertThbNumber (thbAmount) {
    return convertThbToCurrency(thbAmount, selectedCode.value, rates.value)
  }

  return {
    selectedCode,
    rates,
    loaded,
    options,
    labelFor,
    loadRates,
    defaultForLocale,
    applyDefaultForLocale,
    setCurrency,
    initFromStorage,
    formatThb,
    convertThbNumber
  }
})
