/**
 * pending 在线支付订单超时清扫：
 * 在线支付单创建即为 pending 且下单时已扣库存；用户超时未完成支付确认时，
 * 由本服务删除订单并回补库存（复用 orderController 取消/删除的同一套 restoreOrderResources）。
 *
 * 竞态设计：与 confirmOnlinePayment 的条件 UPDATE 互斥 ——
 * 本服务在事务内对订单行加 FOR UPDATE 锁并复查仍为 pending 才删除；
 * 支付确认若先提交，复查会看到 status 已变，直接跳过；
 * 若清扫先删行，确认的条件 UPDATE 影响 0 行，走幂等分支，不会错发积分。
 *
 * 积分流水：point_transactions.order_id 的 FK 是 ON DELETE SET NULL，
 * 直接删订单会把流水的 order_id 静默置 NULL、审计链断掉；
 * 因此删单前先显式 PointTransaction.destroy 清理该单流水。
 */

import { Op } from 'sequelize'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import PointTransaction from '../models/PointTransaction.js'
import sequelize from '../config/database.js'
import { restoreOrderResources } from '../controllers/orderController.js'
import { withDeadlockRetry } from '../utils/dbRetry.js'
import { logger } from '../utils/logger.js'

/** 单次清扫最多处理的订单数，防止积压时一轮扫太久 */
const SWEEP_BATCH_LIMIT = 200

/** 超时时长（分钟）：env ORDER_PENDING_TIMEOUT_MINUTES 可配，默认 10 */
export function getPendingTimeoutMinutes () {
  const n = Number(process.env.ORDER_PENDING_TIMEOUT_MINUTES)
  return Number.isFinite(n) && n > 0 ? n : 10
}

/** 清扫间隔（毫秒）：env ORDER_SWEEP_INTERVAL_MS 可配，默认 60s */
export function getSweepIntervalMs () {
  const n = Number(process.env.ORDER_SWEEP_INTERVAL_MS)
  return Number.isFinite(n) && n > 0 ? n : 60000
}

/**
 * 扫描并清理超时的 pending 在线支付订单（删除订单 + 回补库存/积分）。
 * 单条失败仅记日志、不影响其他订单。
 * @returns {Promise<number>} 本次实际清理（删除）的订单数
 */
export async function sweepExpiredPendingOrders () {
  const cutoff = new Date(Date.now() - getPendingTimeoutMinutes() * 60 * 1000)

  const candidates = await Order.findAll({
    where: {
      status: 'pending',
      payment_method: 'online',
      created_at: { [Op.lt]: cutoff }
    },
    attributes: ['id'],
    limit: SWEEP_BATCH_LIMIT
  })

  let processed = 0
  for (const candidate of candidates) {
    const orderId = candidate.id
    try {
      const done = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          // 行锁读单并复查状态：与支付确认的条件 UPDATE 互斥，防并发竞态
          const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE
          })
          if (!order || order.status !== 'pending' || order.payment_method !== 'online') {
            await transaction.rollback()
            return false
          }

          order.items = await OrderItem.findAll({ where: { order_id: orderId }, transaction })

          // 回补库存（pending 在线单未支付：不涉及积分退/收，restore 内部按字段自行跳过）
          await restoreOrderResources(order, transaction)

          // 先清积分流水：order_id FK 为 ON DELETE SET NULL，直接删单会断审计链
          await PointTransaction.destroy({ where: { order_id: orderId }, transaction })

          await OrderItem.destroy({ where: { order_id: orderId }, transaction })
          await order.destroy({ transaction })

          await transaction.commit()
          return true
        } catch (err) {
          await transaction.rollback().catch(() => {})
          throw err
        }
      })
      if (done) processed++
    } catch (err) {
      // 单条失败不影响其他订单
      logger.error('超时订单清扫失败（已跳过该单）', { orderId, err: err?.message, stack: err?.stack })
    }
  }

  if (processed > 0) {
    logger.info('超时 pending 在线支付订单清扫完成', { processed, candidates: candidates.length })
  }
  return processed
}

/**
 * 启动定时清扫，返回 interval 句柄便于停止。
 * NODE_ENV==='test' 时不启动（防御双保险；app.js 启动链在测试环境同样跳过）。
 */
export function startOrderTimeoutSweeper () {
  if (process.env.NODE_ENV === 'test') return null

  const intervalMs = getSweepIntervalMs()
  const timer = setInterval(() => {
    sweepExpiredPendingOrders().catch(err => {
      logger.error('超时订单清扫任务执行失败', { err: err?.message, stack: err?.stack })
    })
  }, intervalMs)
  // 不阻止进程退出（脚本/一次性进程场景）
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('已启动 pending 在线支付订单超时清扫', {
    intervalMs,
    timeoutMinutes: getPendingTimeoutMinutes()
  })
  return timer
}
