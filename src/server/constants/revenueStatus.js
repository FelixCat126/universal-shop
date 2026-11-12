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
 * 生成"成交订单"的 where 片段（Sequelize Op 语法）。
 *
 * @param {import('sequelize').Op} Op
 * @param {object} [extra] 额外的 where 条件
 * @returns {object}
 */
export function revenueWhere (Op, extra = {}) {
  return { ...extra, status: { [Op.notIn]: NON_REVENUE_STATUSES } }
}
