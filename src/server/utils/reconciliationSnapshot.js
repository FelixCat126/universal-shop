/**
 * 对账快照构建（第 51 轮）
 * ========================
 *
 * ## 用途
 *
 * 超时清扫把订单**物理删掉**之前，把"这张单长什么样"完整抓下来，
 * 写进 `payment_reconciliation_records`（对账台账）——
 * 运营事后拿着它去银行/收款码流水里对：这单有没有、买了什么、多少钱。
 *
 * ## 为什么快照要在这里构建
 *
 * 因为**只有删单之前的那个瞬间**能拿到这些数据：
 * 订单是硬删（未开 paranoid），删掉之后订单行、明细行都不存在了，
 * 商品名/单价/地址这些**只有订单上才有的快照值**再也回捞不到
 * （商品主表现在可能已改名、已下架、已软删）。
 *
 * ## 明细金额用 line_total 而不是 price × quantity
 *
 * `OrderItem.line_total` 是**组合包按权重分摊后的权威行小计**（THB 域）——
 * 组合包场景下 `price × quantity ≠ line_total`（尾差除不尽）。
 * 对账要以它为准，否则台账上的合计与订单实收对不上。
 */

import User from '../models/User.js'
import Partner from '../models/Partner.js'

/**
 * 手机号脱敏：保留前 3 后 4（与 AuditLog.phoneMask 同一口径）。
 * 快照里不需要完整手机号 —— 运营手上有收款流水，尾号足够对上单。
 */
export function maskPhone (phone) {
  if (!phone) return null
  const s = String(phone)
  if (s.length <= 4) return s
  return s.slice(0, 3) + '****' + s.slice(-4)
}

/**
 * 构建零售订单的明细快照。
 *
 * @param {Array} items OrderItem 行
 * @returns {Array<{name,name_th,quantity,unit_price,line_total}>}
 */
export function buildRetailItemsSnapshot (items) {
  return (items || []).map((it) => ({
    name: it.product_name_zh || null,
    name_th: it.product_name_th || null,
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.price) || 0,
    // 权威行小计（组合包分摊后），不是 price × quantity
    line_total: it.line_total != null ? Number(it.line_total) : null
  }))
}

/**
 * 构建合作方订单的明细快照。
 *
 * @param {Array} items PartnerOrderItem 行
 * @returns {Array<{name,quantity,unit_price,line_total}>}
 */
export function buildPartnerItemsSnapshot (items) {
  return (items || []).map((it) => ({
    name: it.product_name_snapshot || null,
    name_th: null,
    quantity: Number(it.quantity) || 0,
    unit_price: it.unit_price_thb != null ? Number(it.unit_price_thb) : 0,
    line_total: it.line_total_thb != null ? Number(it.line_total_thb) : null
  }))
}

/**
 * 取零售下单人的脱敏标识（手机号优先，其次登录名）。
 *
 * 只查 id/username/phone 三个列，且**不加行锁** —— 纯读，不参与订单行的
 * 加锁顺序，不会引入新的死锁面。
 *
 * @param {number|null} userId
 * @param {object} [transaction]
 * @returns {Promise<string|null>}
 */
export async function resolveRetailUserLabel (userId, transaction) {
  if (!userId) return null
  const user = await User.findByPk(userId, {
    attributes: ['id', 'username', 'phone'],
    transaction
  })
  if (!user) return null
  return user.phone ? maskPhone(user.phone) : (user.username || null)
}

/**
 * 取合作方的脱敏标识（登录名优先，其次显示名）。
 *
 * @param {number|null} partnerId
 * @param {object} [transaction]
 * @returns {Promise<string|null>}
 */
export async function resolvePartnerLabel (partnerId, transaction) {
  if (!partnerId) return null
  const partner = await Partner.findByPk(partnerId, {
    attributes: ['id', 'login', 'display_name'],
    transaction
  })
  if (!partner) return null
  return partner.login || partner.display_name || null
}
