/** 合作方订货：仅以泰铢底价为准，与普通门户展示逻辑一致的基础单价 */

import { parsePartnerMoqValue } from '../utils/partnerMoq.js'

/** 金额统一舍入到分：+Number.EPSILON 消除 0.5 分位的浮点误差（如 1.005*100=100.499…） */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function retailBaseUnitThb (product) {
  const price = parseFloat(String(product?.price ?? 0))
  let base = Number.isFinite(price) ? price : 0
  const d = product?.discount != null ? Number(product.discount) : 0
  if (Number.isFinite(d) && d > 0 && d <= 100) {
    base *= 1 - d / 100
  }
  return round2(base)
}

export function partnerUnitPriceAfterDiscount (product, discountPercent) {
  const base = retailBaseUnitThb(product)
  const dp = Math.min(100, Math.max(0, Number(discountPercent) || 0))
  const unit = base * (1 - dp / 100)
  return round2(unit)
}

/** MOQ：qty>=unit 且增量为 multiplier 倍数（相对 unit 的余数）；unit/step 与 partnerMoq 同套解析 */
export function isValidPartnerQuantity (qty, moqUnit, moqMultiplier) {
  const unit = parsePartnerMoqValue(moqUnit, 50)
  const step = parsePartnerMoqValue(moqMultiplier, unit)
  const q = Number(qty)
  if (!Number.isInteger(q) || q < unit) return false
  return (q - unit) % step === 0
}

export function validateMoqOrThrow (qty, moqUnit, moqMultiplier) {
  if (!isValidPartnerQuantity(qty, moqUnit, moqMultiplier)) {
    const u = parsePartnerMoqValue(moqUnit, 50)
    const s = parsePartnerMoqValue(moqMultiplier, u)
    throw Object.assign(new Error(`数量须从 ${u} 起，并按 ${s} 的倍数增加`), { status: 400 })
  }
}
