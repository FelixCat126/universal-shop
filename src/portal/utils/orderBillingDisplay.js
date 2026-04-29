import { symbolForCurrencyCode } from '../../utils/exchangeRatesDisplay'

/**
 * 订单展示：按下单时币种（后端 total_amount + currency_code）
 */
export function formatRecordedOrderAmount (order) {
  const cc = order.currency_code || 'THB'
  const amt = parseFloat(order.total_amount)
  const main = `${cc} ${symbolForCurrencyCode(cc)}${Number.isFinite(amt) ? amt.toFixed(2) : String(order.total_amount ?? '')}`
  const thb = order.total_amount_thb != null && order.total_amount_thb !== ''
    ? parseFloat(order.total_amount_thb)
    : null
  return {
    currencyCode: cc,
    mainLabel: main,
    amountThb: Number.isFinite(thb) ? thb : null
  }
}

/** 订单项均为泰铢底价，按比例折算到下单记账币种一行展示 */
export function formatLineRecordedFromThb (order, lineThb) {
  const thbTot = parseFloat(order.total_amount_thb)
  const billingTot = parseFloat(order.total_amount)
  const line = Number(lineThb)
  if (!(Number.isFinite(thbTot) && thbTot > 0) || !Number.isFinite(billingTot) || !Number.isFinite(line)) {
    const cc = order.currency_code || 'THB'
    return `${cc} ${symbolForCurrencyCode(cc)}${Number.isFinite(line) ? line.toFixed(2) : '0.00'}`
  }
  const part = billingTot * (line / thbTot)
  const cc = order.currency_code || 'THB'
  return `${cc} ${symbolForCurrencyCode(cc)}${part.toFixed(2)}`
}
