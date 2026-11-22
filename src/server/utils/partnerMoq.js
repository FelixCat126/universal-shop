import SystemConfig from '../models/SystemConfig.js'

/**
 * MOQ 配置统一解析（partnerPricingService 复用，保证展示与下单校验同口径）：
 * 非正数/NaN 回退 fallback，小数向下取整，最小为 1（保证 step >= 1，不会出现 % 0 → NaN）
 */
export function parsePartnerMoqValue (value, fallback = 1) {
  const n = Number(value) || fallback
  return Math.max(1, Math.floor(n))
}

/**
 * 第 49 轮：改用 `SystemConfig.getConfig`（自带 10s LRU 缓存 + 写时失效）。
 *
 * 原来这里是两次裸 `SystemConfig.findOne` → **绕过了缓存层**，
 * 而这个函数在**每次合作方商品列表请求**与**每次下单**时都要调 →
 * 配置值几乎不变，却每次都查库。
 */
export async function getPartnerMoqFromDb () {
  const [unitValue, multValue] = await Promise.all([
    SystemConfig.getConfig('partner_order_moq_unit'),
    SystemConfig.getConfig('partner_order_moq_multiplier')
  ])
  const moqUnit = parsePartnerMoqValue(unitValue ?? '50', 50)
  /** 步长：默认 1，即仅要求 ≥ 起订量后可按件加购 */
  const moqMultiplier = parsePartnerMoqValue(multValue ?? '1', 1)
  return { moqUnit, moqMultiplier }
}
