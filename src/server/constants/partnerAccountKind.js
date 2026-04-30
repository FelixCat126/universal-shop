/** 合作方账号类别（与 partners.account_kind 一致） */
export const PARTNER_KIND_DEALER = 'dealer'
export const PARTNER_KIND_AGENT = 'agent'

/** 代理下单约束（与 PRD / partnerPortalController 对齐） */
export const PARTNER_AGENT_MOQ_UNIT = 20
export const PARTNER_AGENT_MOQ_MULTIPLIER = 1
export const PARTNER_AGENT_MAX_DISTINCT_PRODUCTS = 3

export function isPartnerAgent (partnerLike) {
  return partnerLike?.account_kind === PARTNER_KIND_AGENT
}

export function parsePartnerAccountKind (v) {
  const s = v != null ? String(v).trim() : ''
  if (s === PARTNER_KIND_AGENT) return PARTNER_KIND_AGENT
  return PARTNER_KIND_DEALER
}
