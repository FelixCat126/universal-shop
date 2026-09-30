import SystemConfig from '../models/SystemConfig.js'

/**
 * MOQ 配置统一解析（partnerPricingService 复用，保证展示与下单校验同口径）：
 * 非正数/NaN 回退 fallback，小数向下取整，最小为 1（保证 step >= 1，不会出现 % 0 → NaN）
 */
export function parsePartnerMoqValue (value, fallback = 1) {
  const n = Number(value) || fallback
  return Math.max(1, Math.floor(n))
}

export async function getPartnerMoqFromDb () {
  const [unitRow, multRow] = await Promise.all([
    SystemConfig.findOne({ where: { config_key: 'partner_order_moq_unit' } }),
    SystemConfig.findOne({ where: { config_key: 'partner_order_moq_multiplier' } })
  ])
  const moqUnit = parsePartnerMoqValue(unitRow?.config_value ?? '50', 50)
  /** 步长：默认 1，即仅要求 ≥ 起订量后可按件加购 */
  const moqMultiplier = parsePartnerMoqValue(multRow?.config_value ?? '1', 1)
  return { moqUnit, moqMultiplier }
}
