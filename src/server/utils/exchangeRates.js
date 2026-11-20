/** 汇算键：USD 视同 USDT，另支持 CNY、MYR（相对泰铢标价） */
import { roundMoney, convertMoney, formatAmount } from '../../shared/money.js'

export const FX_KEYS = ['USD', 'CNY', 'MYR']

export function defaultExchangeRates () {
  return { USD: '0.00', CNY: '0.00', MYR: '0.00' }
}

/**
 * @param {unknown} raw
 * @returns {{ USD: string, CNY: string, MYR: string }}
 */
export function normalizeExchangeRates (raw) {
  const d = defaultExchangeRates()
  if (!raw || typeof raw !== 'object') return d
  for (const k of FX_KEYS) {
    const v = raw[k]
    const n = v == null || v === '' ? 0 : parseFloat(String(v))
    const num = Number.isFinite(n) ? Math.max(0, n) : 0
    d[k] = formatAmount(num)
  }
  return d
}

/** @param {string|number} value */
export function parseSingleRate (value) {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
  if (!Number.isFinite(num) || num < 0) return 0
  // 统一走共享的 cents 舍入（原先用 Math.round(num*100)/100，与 toFixed 路径不一致）
  return roundMoney(num)
}

/**
 * 泰铢底价 → 用户结算币种对应金额（与门户公式一致）
 * @param {number} thbAmt
 * @param {'THB'|'USD'|'CNY'|'MYR'} currency
 * @param {{ USD: string, CNY: string, MYR: string }} rates
 */
export function thbToBillingAmount (thbAmt, currency, rates) {
  const base = Number.isFinite(thbAmt) ? thbAmt : 0
  if (currency === 'THB') return roundMoney(base)
  const r = parseFloat(rates[currency] ?? '0')
  const rate = Number.isFinite(r) && r >= 0 ? r : 0
  /**
   * ⚠️ 原先是 `parseFloat((base * rate).toFixed(2))` —— toFixed 的二进制浮点陷阱
   * 会让结算金额与前端显示差 1 分钱（2.675 → 2.67 而前端是 2.68）。
   * 现在统一走共享的 cents 舍入。
   */
  return convertMoney(base, rate)
}

export function normalizeCheckoutCurrency (raw) {
  const c = String(raw || 'THB').trim().toUpperCase()
  if (['THB', 'USD', 'CNY', 'MYR'].includes(c)) return c
  return 'THB'
}
