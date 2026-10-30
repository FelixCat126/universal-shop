import { Op } from 'sequelize'
import AuditLog from '../models/AuditLog.js'
import OperationLog from '../models/OperationLog.js'
import PointTransaction from '../models/PointTransaction.js'
import UserCoupon from '../models/UserCoupon.js'
import Cart from '../models/Cart.js'
import { logger } from '../utils/logger.js'

/**
 * 数据保留策略：清理只增不减的历史表，防止随业务量无限膨胀。
 *
 * 覆盖的表（都是「只写不删」或「几乎不删」的）：
 *   audit_logs         365 天 —— 审计留痕
 *   operation_logs     730 天 —— 后台操作日志
 *   point_transactions 730 天 —— 积分流水（余额权威在 user_point_balances，
 *                                    流水只作历史凭证，过老的对账价值有限）
 *   user_coupons       365 天 —— 已使用/已过期的券（未使用的券是用户资产，
 *                                    不能删）
 *   carts（游客）        30 天 —— session_id 维度的游客购物车，
 *                                    用户自己的购物车要保留
 *
 * 删除采用「循环批次直到删完」：早期实现每天只删 limit 条，
 * 积压 10 万条需要 100 天才能删完，等于没有清理。
 */

/** 单表删除：循环直到本轮无更多可删（受 maxBatches 上限保护，避免长事务） */
async function purgeInBatches (Model, where, batchSize, maxBatches = 200) {
  let total = 0
  for (let i = 0; i < maxBatches; i++) {
    const deleted = await Model.destroy({ where, limit: batchSize })
    total += deleted
    if (deleted < batchSize) break
  }
  return total
}

export async function cleanupRetentionData ({
  auditDays = 365,
  operationDays = 730,
  pointDays = 730,
  couponDays = 365,
  expiredCouponDays = 30,
  guestCartDays = 30,
  batchSize = 1000
} = {}) {
  const now = Date.now()
  const day = 86400000
  const auditCutoff = new Date(now - auditDays * day)
  const operationCutoff = new Date(now - operationDays * day)
  const pointCutoff = new Date(now - pointDays * day)
  const couponCutoff = new Date(now - couponDays * day)
  const guestCartCutoff = new Date(now - guestCartDays * day)

  const auditDeleted = await purgeInBatches(AuditLog, { created_at: { [Op.lt]: auditCutoff } }, batchSize)
  const operationDeleted = await purgeInBatches(OperationLog, { created_at: { [Op.lt]: operationCutoff } }, batchSize)
  const pointDeleted = await purgeInBatches(PointTransaction, { created_at: { [Op.lt]: pointCutoff } }, batchSize)

  /**
   * 券：只清理「已不可用」的券，未使用的券属于用户资产，绝不能删。
   *   - status='used'    ：按消费时间（updated_at）保留一年，之后清理
   *   - status='expired' ：按有效期（expire_at）判断 —— 券已过期即不可用，
   *                        不该因为用户最近才打开过就一直留着；
   *                        过期超过 30 天才清理，给用户一个「看到历史券」的窗口
   */
  const expiredCouponCutoff = new Date(now - expiredCouponDays * day)
  const couponDeleted = await purgeInBatches(UserCoupon, {
    [Op.or]: [
      { status: 'used', updated_at: { [Op.lt]: couponCutoff } },
      { status: 'expired', expire_at: { [Op.lt]: expiredCouponCutoff } }
    ]
  }, batchSize)

  // 游客购物车：session_id 维度且无 user_id 的，保留 30 天
  const guestCartDeleted = await purgeInBatches(Cart, {
    session_id: { [Op.ne]: null },
    user_id: null,
    updated_at: { [Op.lt]: guestCartCutoff }
  }, batchSize)

  return {
    auditDeleted,
    operationDeleted,
    pointDeleted,
    couponDeleted,
    guestCartDeleted
  }
}

export function startRetentionCleanup () {
  if (process.env.NODE_ENV === 'test') return null
  const timer = setInterval(() => {
    cleanupRetentionData().catch((err) => {
      logger.error('数据保留清理失败', { err: err?.message, stack: err?.stack })
    })
  }, 24 * 60 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}
