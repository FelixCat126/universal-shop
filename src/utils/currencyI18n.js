/** 与 admin / portal i18n 的 locale 键一致 */
export const CURRENCY_I18N_LOCALES = ['zh-CN', 'en-US', 'th-TH']

/** 数据库存储的货币代码（与 config_key currency_unit 的值一致） */
export const CURRENCY_CODES = ['THB', 'USD', 'CNY']

/**
 * 金额前缀仅用符号；currencyName 为当前语言「名称 + 空格 + 符号」
 * @type {Record<string, Record<string, { currency: string, currencyName: string }>>}
 */
const DISPLAY_BY_LOCALE = {
  'zh-CN': {
    THB: { currency: '฿', currencyName: '泰铢 ฿' },
    USD: { currency: '$', currencyName: '美元 $' },
    CNY: { currency: '¥', currencyName: '人民币 ¥' }
  },
  'en-US': {
    THB: { currency: '฿', currencyName: 'Thai Baht ฿' },
    USD: { currency: '$', currencyName: 'US Dollar $' },
    CNY: { currency: '¥', currencyName: 'Chinese Yuan ¥' }
  },
  'th-TH': {
    THB: { currency: '฿', currencyName: 'บาทไทย ฿' },
    USD: { currency: '$', currencyName: 'ดอลลาร์สหรัฐ $' },
    CNY: { currency: '¥', currencyName: 'หยวนจีน ¥' }
  }
}

const FALLBACK = DISPLAY_BY_LOCALE['zh-CN'].THB

/**
 * 将历史配置（符号或写法）规范为 THB | USD | CNY，默认泰铢
 * @param {unknown} raw
 * @returns {'THB'|'USD'|'CNY'}
 */
export function normalizeCurrencyCode (raw) {
  if (raw == null || raw === '') return 'THB'
  const s = String(raw).trim()
  const u = s.toUpperCase()
  if (CURRENCY_CODES.includes(u)) return u
  if (s === '¥' || u === 'RMB' || s === '元' || u === '人民币') return 'CNY'
  if (s === '$' || s === '＄' || u === 'US$' || u === 'DOLLAR') return 'USD'
  if (s === '฿' || u === 'BAHT') return 'THB'
  return 'THB'
}

function displayFor (locale, code) {
  const c = normalizeCurrencyCode(code)
  return DISPLAY_BY_LOCALE[locale]?.[c] || DISPLAY_BY_LOCALE['zh-CN'][c] || FALLBACK
}

/**
 * @param {import('vue-i18n').I18n} i18n
 * @param {unknown} code
 */
export function applyCurrencyCodeToI18n (i18n, code) {
  if (!i18n?.global?.mergeLocaleMessage) return
  const c = normalizeCurrencyCode(code)
  for (const loc of CURRENCY_I18N_LOCALES) {
    const row = displayFor(loc, c)
    i18n.global.mergeLocaleMessage(loc, {
      common: {
        currency: row.currency,
        currencyName: row.currencyName
      }
    })
  }
}

/**
 * 组件内仅有 mergeLocaleMessage 时使用
 * @param {(locale: string, msg: object) => void} mergeLocaleMessage
 * @param {unknown} code
 */
export function mergeCurrencyCodeIntoLocales (mergeLocaleMessage, code) {
  if (typeof mergeLocaleMessage !== 'function') return
  const c = normalizeCurrencyCode(code)
  for (const loc of CURRENCY_I18N_LOCALES) {
    const row = displayFor(loc, c)
    mergeLocaleMessage(loc, {
      common: {
        currency: row.currency,
        currencyName: row.currencyName
      }
    })
  }
}

/** @deprecated 使用 applyCurrencyCodeToI18n */
export function applyCurrencyUnitToI18n (i18n, symbolOrCode) {
  applyCurrencyCodeToI18n(i18n, symbolOrCode)
}

/**
 * @param {import('vue-i18n').I18n} i18n
 * @param {string} [apiBase] 如 '' 表示同源 /api
 */
export async function fetchAndApplyCurrencyUnit (i18n, apiBase = '') {
  try {
    const base = apiBase.replace(/\/$/, '')
    const url = `${base}/api/system-config/public`
    const res = await fetch(url)
    const json = await res.json()
    if (json.success && json.data) {
      const code =
        json.data.currency_code != null && String(json.data.currency_code).trim() !== ''
          ? json.data.currency_code
          : json.data.currency_unit
      applyCurrencyCodeToI18n(i18n, code)
    } else {
      applyCurrencyCodeToI18n(i18n, 'THB')
    }
  } catch (e) {
    console.warn('加载货币单位配置失败，使用默认泰铢', e)
    applyCurrencyCodeToI18n(i18n, 'THB')
  }
}
