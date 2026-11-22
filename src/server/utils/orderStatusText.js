/**
 * 订单状态的中文名（第 48 轮）
 * =============================
 *
 * ## 为什么要有它
 *
 * 后端的消息里直接写内部枚举值：
 *
 *   订单状态不允许从「pending」变更为「cancelled」
 *   不允许从「shipping」变更为「paid」
 *
 * 「pending / shipping / cancelled」是**数据库里的值**，不是人话；
 * 终端用户看到的是客户端弹出的这句（OrderDetail.vue 原样透传）。
 *
 * 现在统一映射成中文：
 *   订单状态不允许从「待支付」变更为「已取消」
 *
 * 后端没有 Accept-Language 处理（消息只有中文），
 * 所以前端若认得这个状态，会用自己的语言替换（见各端的状态文案）。
 */

/** 零售订单状态 → 中文 */
export const ORDER_STATUS_TEXT = {
  pending: '待支付',
  paid: '已支付',
  shipping: '备货中',
  shipped: '已发货',
  delivered: '已送达',
  completed: '已完成',
  cancelled: '已取消'
}

/** 合作方订单状态 → 中文 */
export const PARTNER_ORDER_STATUS_TEXT = {
  pending_payment: '待付款',
  submitted: '已提交',
  processing: '备货中',
  shipped: '已发货',
  settled: '已结算',
  cancelled: '已取消'
}

/**
 * 取状态的中文名（认不出就退回原值，不编造）。
 * @param {string} status
 * @param {object} [map] 状态映射表
 */
export function statusText (status, map = ORDER_STATUS_TEXT) {
  if (!status) return ''
  return map[status] || status
}
