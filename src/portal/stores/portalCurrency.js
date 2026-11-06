import { defineStore } from 'pinia'
import { ref } from 'vue'
import { PORTAL_CURRENCIES, formatConvertedMoney, convertThbToCurrency } from '../../utils/exchangeRatesDisplay.js'
import { loadPublicConfig } from '../../utils/publicConfig.js'

// 全站共享的 /api/system-config/public 拉取（30s 缓存 + in-flight 去重），各页面统一从这里取公开配置
export { loadPublicConfig }

const STORAGE_KEY = 'portal_currency'

/**
 * 兜底用的默认展示币种（**只在站点配置还没拿到时**用）。
 *
 * 正式规则是「跟随站点配置的结算币种」（system_configs.currency_unit）：
 * 这是一家泰国商城，商品价就是泰铢，中文界面不代表要用人民币标价。
 * 界面语言是给人看的，币种是钱的事 —— 两者不该绑在一起。
 */
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
  /** 站点配置的结算币种（system_configs.currency_unit，THB/USD/CNY/MYR） */
  const siteCurrency = ref(null)

  const options = PORTAL_CURRENCIES

  const labelFor = (code) => PORTAL_CURRENCIES.find((c) => c.code === code)?.label ?? code

  async function loadRates () {
    try {
      const data = await loadPublicConfig()
      const er = data?.exchange_rates
      if (er && typeof er === 'object') {
        rates.value = {
          USD: er.USD ?? '0.00',
          CNY: er.CNY ?? '0.00',
          MYR: er.MYR ?? '0.00'
        }
      }
      // 站点配置的结算币种：用户没手动选过时，展示币种跟它走
      const site = String(data?.currency_code || data?.currency_unit || '').trim().toUpperCase()
      if (VALID.has(site)) siteCurrency.value = site
    } finally {
      loaded.value = true
    }
  }

  function defaultForLocale (locale) {
    return DEFAULT_CURRENCY_BY_LOCALE[locale] || 'THB'
  }

  /**
   * 恢复默认展示币种：**跟随站点配置**（不是界面语言）。
   *
   * 注意**不写** localStorage：自动推导出来的值不能被当成"用户选过"，
   * 否则以后站点改了结算币种，这些用户会一直卡在旧值上。
   */
  function applyDefaultForLocale (locale) {
    selectedCode.value = siteCurrency.value || defaultForLocale(locale)
  }

  function setCurrency (code) {
    const c = String(code || '').toUpperCase()
    if (!VALID.has(c)) return
    selectedCode.value = c
    try {
      localStorage.setItem(STORAGE_KEY, c)
    } catch (_) {}
  }

  /**
   * 应用启动：
   *   1. 用户**手动**选过币种 → 尊重他的选择
   *   2. 没选过 → 跟随**站点配置的结算币种**（泰国商城 = THB）
   *   3. 配置还没拿到 → 用语言兜底
   *
   * 迁移：老版本会把"按语言自动推导的默认值"也写进 localStorage，
   * 于是中文界面的老用户缓存里是 CNY —— 那是自动值不是他选的，
   * 这里按"等于语言默认值"判定为自动值 → 改跟随站点币种。
   */
  function initFromStorage (locale) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw && VALID.has(raw)) {
        const isLegacyAuto = raw === defaultForLocale(locale)
        if (!isLegacyAuto) {
          selectedCode.value = raw
          return
        }
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
    siteCurrency,
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
