import SystemConfig from '../models/SystemConfig.js'

export async function getPartnerMoqFromDb () {
  const [unitRow, multRow] = await Promise.all([
    SystemConfig.findOne({ where: { config_key: 'partner_order_moq_unit' } }),
    SystemConfig.findOne({ where: { config_key: 'partner_order_moq_multiplier' } })
  ])
  const moqUnit = Math.max(1, parseInt(String(unitRow?.config_value ?? '50'), 10) || 50)
  /** 步长：默认 1，即仅要求 ≥ 起订量后可按件加购 */
  const moqMultiplier = Math.max(1, parseInt(String(multRow?.config_value ?? '1'), 10) || 1)
  return { moqUnit, moqMultiplier }
}
