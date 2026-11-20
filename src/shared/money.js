/**
 * 统一金额舍入（服务端与三个前端共用）
 * =================================================
 *
 * ## 为什么要有这个文件
 *
 * 改造前，**同一个项目里并存三套舍入实现**：
 *
 *   | 位置 | 写法 | 2.675 的结果 |
 *   |---|---|---|
 *   | 服务端 `exchangeRates.thbToBillingAmount` | `parseFloat(x.toFixed(2))` | **2.67** ❌ |
 *   | 服务端 `pricingEngine.round2` | `Math.round((n + EPSILON) * 100) / 100` | 2.68 ✅ |
 *   | 前端 `convertedAmountLines` | `cv.toFixed(2)` | **2.67** ❌ |
 *   | 前端 `convertThbToCurrency` | `Math.round(n * 100) / 100` | 2.68 ✅ |
 *
 * `toFixed` 的问题是**二进制浮点**：`(2.675).toFixed(2) === "2.67"`（应为 2.68），
 * `(1.005).toFixed(2) === "1.00"`（应为 1.01）。
 *
 * 后果不是"显示难看"，而是**对账差 1 分钱**：
 * 服务端用 toFixed 算出的结算金额，与前端用 cents 法显示的价格可能差 0.01 ——
 * 用户看到的金额和实际扣的金额不是一回事。
 *
 * ## 统一口径
 *
 * 一律走**分（cents）整数**：
 *   roundMoney(2.675) === 2.68
 *   换算也是：先乘后取整到分，不做中途四舍五入。
 *
 * 显示时也用同一套：`formatAmount` 先 cents 化再格式化，
 * 保证**显示值 === 存储值**（不会出现"存 2.68、显示 2.67"）。
 */

/**
 * 金额 → 分（整数）。
 *
 * ⚠️ 光用 `Math.round(v * 100)` **还不够**：
 *   1.005 * 100 = 100.49999999999999 → Math.round 得 100 → 1.00（应为 1.01）
 *   2.675 * 100 = 267.49999999999994 → 得 267 → 2.67（应为 2.68）
 *
 * 所以先用 `toPrecision(15)` **抹掉二进制尾数**，再取整：
 *   100.49999999999999 → "100.500000000000" → 100.5 → 101 ✓
 *
 * 非有限数按 0 处理；负数按"远离零"舍入（与财务习惯一致）。
 * @param {number|string} n
 * @returns {number} 整数分
 */
export function toCents (n) {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? ''))
  if (!Number.isFinite(v)) return 0
  /**
   * 负数取"远离零"：JS 的 Math.round(-267.5) = -267（向 +∞ 取整），
   * 与财务直觉（-2.675 → -2.68）相反 → 先对绝对值取整再补符号。
   */
  const cents = Math.round(Number((Math.abs(v) * 100).toPrecision(15)))
  return v < 0 ? -cents : cents
}

/**
 * 分 → 金额。
 * @param {number} cents
 * @returns {number}
 */
export function fromCents (cents) {
  const c = Number.isFinite(Number(cents)) ? Math.round(Number(cents)) : 0
  return c / 100
}

/**
 * 金额舍入到分（统一口径）。
 * @param {number|string} n
 * @returns {number}
 */
export function roundMoney (n) {
  return fromCents(toCents(n))
}

/**
 * 按汇率换算并舍入到分。
 *
 * ⚠️ 必须**先乘后舍入**，不能先舍入底价再乘 —— 后者会引入二次误差。
 * @param {number|string} amount 底价金额
 * @param {number|string} rate 汇率
 * @returns {number}
 */
export function convertMoney (amount, rate) {
  const a = typeof amount === 'number' ? amount : parseFloat(String(amount ?? ''))
  const r = typeof rate === 'number' ? rate : parseFloat(String(rate ?? ''))
  if (!Number.isFinite(a) || !Number.isFinite(r)) return 0
  return fromCents(toCents(a * r))
}

/**
 * 金额 → 展示字符串（两位小数）。
 *
 * 先 cents 化再格式化 → 显示值与存储值一致。
 * @param {number|string} n
 * @returns {string} 形如 "2.68"
 */
export function formatAmount (n) {
  return fromCents(toCents(n)).toFixed(2)
}

/**
 * 带符号的金额展示（如订单列表的 "฿2.68"）。
 * @param {number|string} n
 * @param {string} symbol
 * @returns {string}
 */
export function formatAmountWithSymbol (n, symbol = '') {
  return `${symbol}${formatAmount(n)}`
}
