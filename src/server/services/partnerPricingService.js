/** 合作方订货：仅以泰铢底价为准，与普通门户展示逻辑一致的基础单价 */

export function retailBaseUnitThb (product) {
  const price = parseFloat(String(product?.price ?? 0))
  let base = Number.isFinite(price) ? price : 0
  const d = product?.discount != null ? Number(product.discount) : 0
  if (Number.isFinite(d) && d > 0 && d <= 100) {
    base *= 1 - d / 100
  }
  return Math.round(base * 100) / 100
}

export function partnerUnitPriceAfterDiscount (product, discountPercent) {
  const base = retailBaseUnitThb(product)
  const dp = Math.min(100, Math.max(0, Number(discountPercent) || 0))
  const unit = base * (1 - dp / 100)
  return Math.round(unit * 100) / 100
}

/** MOQ：qty>=unit 且增量为 multiplier 倍数（相对 unit 的余数） */
export function isValidPartnerQuantity (qty, moqUnit, moqMultiplier) {
  const unit = Number(moqUnit) || 50
  const step = Number(moqMultiplier) || unit
  const q = Number(qty)
  if (!Number.isInteger(q) || q < unit) return false
  return (q - unit) % step === 0
}

export function validateMoqOrThrow (qty, moqUnit, moqMultiplier) {
  if (!isValidPartnerQuantity(qty, moqUnit, moqMultiplier)) {
    const u = Number(moqUnit) || 50
    const s = Number(moqMultiplier) || u
    throw Object.assign(new Error(`数量须从 ${u} 起，并按 ${s} 的倍数增加`), { status: 400 })
  }
}
