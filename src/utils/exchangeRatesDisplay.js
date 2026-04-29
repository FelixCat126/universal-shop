/** 门户展示：美元/人民币/马来西亚令吉（相对泰铢底价的汇算比例） */

export const FX_DISPLAY_ORDER = [
  { key: 'USD', symbol: '$' },
  { key: 'CNY', symbol: '¥' },
  { key: 'MYR', symbol: 'RM' }
]

/** 用户可选展示币种（底价为泰铢时：金额 = 泰铢 × 比例；泰铢则为原价） */
export const PORTAL_CURRENCIES = [
  { code: 'CNY', label: 'CNY (¥)' },
  { code: 'USD', label: 'USD ($)' },
  { code: 'THB', label: 'THB (฿)' },
  { code: 'MYR', label: 'MYR (RM)' }
]

/** @param {'THB'|'USD'|'CNY'|'MYR'} code */
export function symbolForCurrencyCode (code) {
  switch (code) {
    case 'THB':
      return '฿'
    case 'USD':
      return '$'
    case 'CNY':
      return '¥'
    case 'MYR':
      return 'RM'
    default:
      return ''
  }
}

/**
 * @param {number|string} thbAmount 泰铢标价（或与折扣后的实付泰铢）
 * @param {{ USD?: string, CNY?: string, MYR?: string }} [rates]
 * @returns { { key: string, symbol: string, amount: string }[] }
 */
export function convertedAmountLines (thbAmount, rates) {
  const thb = parseFloat(String(thbAmount))
  const base = Number.isFinite(thb) ? thb : 0
  if (!rates || typeof rates !== 'object') return []
  const out = []
  for (const { key, symbol } of FX_DISPLAY_ORDER) {
    const rs = rates[key]
    const r = rs == null || rs === '' ? 0 : parseFloat(String(rs))
    const rate = Number.isFinite(r) && r >= 0 ? r : 0
    if (rate <= 0) continue
    const cv = base * rate
    out.push({ key, symbol, amount: cv.toFixed(2) })
  }
  return out
}

/**
 * @param {number|string} thbAmount
 * @param {'THB'|'USD'|'CNY'|'MYR'} currencyCode
 * @param {{ USD?: string, CNY?: string, MYR?: string }} rates
 * @returns {number}
 */
export function convertThbToCurrency (thbAmount, currencyCode, rates) {
  const thb = parseFloat(String(thbAmount))
  const base = Number.isFinite(thb) ? thb : 0
  if (currencyCode === 'THB') return Math.round(base * 100) / 100
  if (!rates || typeof rates !== 'object') return 0
  const r = rates[currencyCode]
  const rate = r == null || r === '' ? 0 : parseFloat(String(r))
  const n = Number.isFinite(rate) && rate >= 0 ? rate : 0
  if (n <= 0) return 0
  return Math.round(base * n * 100) / 100
}

/**
 * @param {number|string} thbAmount
 * @param {'THB'|'USD'|'CNY'|'MYR'} currencyCode
 * @param {{ USD?: string, CNY?: string, MYR?: string }} rates
 */
export function formatConvertedMoney (thbAmount, currencyCode, rates) {
  const base = parseFloat(String(thbAmount))
  const thbNum = Number.isFinite(base) ? base : 0
  const code = String(currencyCode || 'THB').toUpperCase()
  /** 底价非 0 但所选外币汇率缺失或为 0 时仍按泰铢标价展示，避免出现 ¥0.00/$0 */
  const asThb = () => `${symbolForCurrencyCode('THB')}${thbNum.toFixed(2)}`
  if (code === 'THB') return asThb()
  let rateNum = 0
  const raw = rates?.[code]
  if (raw != null && raw !== '') {
    const p = parseFloat(String(raw))
    if (Number.isFinite(p)) rateNum = p
  }
  if (!(rateNum > 0)) {
    return thbNum !== 0 ? asThb() : `${symbolForCurrencyCode(code)}${(0).toFixed(2)}`
  }
  const n = convertThbToCurrency(thbAmount, currencyCode, rates)
  return `${symbolForCurrencyCode(currencyCode)}${n.toFixed(2)}`
}
