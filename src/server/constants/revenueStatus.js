/**
 * 「真实成交」订单的口径 —— 全站唯一来源。
 *
 * 什么算成交？**钱到账了**才算：
 *   - pending   —— 下单没付（还没成交）
 *   - cancelled —— 已取消（没成交）
 * 其余（paid / shipping / shipped / delivered / completed）都算成交。
 *
 * 为什么要有这个口径：
 * 「营收 / 累计消费」这个数字如果把未付款和已取消的单也算进去，就会**虚高** ——
 * 商家看着面板上的营收比实际到账多，去对账时对不上，以为是系统算错了。
 *
 * ⚠️ 之前这个口径只在一个地方（订单列表的累计消费）落实了，
 * 面板的总营收/今日营收、门户个人中心的累计消费、订单列表的今日营收
 * 都没跟上 → **同一个指标在四个地方四个数**。
 * 现在统一从这里取。
 */

/** 不计入成交金额的订单状态 */
export const NON_REVENUE_STATUSES = ['pending', 'cancelled']

/**
 * 不计入成交金额的**支付方式**。
 *
 * 积分换购单（payment_method='points'）用积分付的钱，实收金额记 0 ——
 * 所以它对营收**没有数值影响**。但门户个人中心的累计消费**显式**排除了它，
 * 面板与订单列表的今日营收没有排除 → 口径靠"积分单金额恒为 0"这个隐含前提撑着。
 * 一旦出现历史遗留的积分单（total_amount_thb 非 0），同一个指标就会两个数。
 *
 * 所以：三个地方一律用下面这两个函数生成条件，**不再各写一遍**。
 */
export const NON_REVENUE_PAYMENT_METHODS = ['points']

/**
 * 生成"成交订单"的 where 片段（Sequelize Op 语法）。
 *
 * @param {import('sequelize').Op} Op
 * @param {object} [extra] 额外的 where 条件
 * @returns {object}
 */
export function revenueWhere (Op, extra = {}) {
  return {
    ...extra,
    status: { [Op.notIn]: NON_REVENUE_STATUSES },
    payment_method: { [Op.notIn]: NON_REVENUE_PAYMENT_METHODS }
  }
}

/**
 * 生成"成交订单"的 **SQL 片段**（给 PG 的 FILTER 子句用）。
 *
 * 面板与订单列表的聚合要用 FILTER（一个 WHERE 会把订单数也滤掉），
 * 那时不能走 Op 对象 → 这里给出与 revenueWhere **完全同口径**的文本版。
 *
 * ⚠️ 传进来的 escape 必须能正确转义字符串（用 sequelize.escape）。
 *
 * @param {(v: string) => string} escape
 * @returns {string}
 */
export function revenueStatusSql (escape) {
  const esc = typeof escape === 'function' ? escape : (v) => `'${String(v)}'`
  const statuses = NON_REVENUE_STATUSES.map(esc).join(', ')
  const methods = NON_REVENUE_PAYMENT_METHODS.map(esc).join(', ')
  return `status NOT IN (${statuses}) AND payment_method NOT IN (${methods})`
}
