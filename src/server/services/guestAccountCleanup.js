import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import User from '../models/User.js'
import Order from '../models/Order.js'
import Cart from '../models/Cart.js'
import { logger } from '../utils/logger.js'

/**
 * 清理长期未下单的游客空账号（must_reset_password=true 且从未下单）。
 * 默认只清理 7 天前的账号，每批最多 500 个，避免误删近期真实用户。
 */
export async function cleanupAbandonedGuestAccounts ({ olderThanDays = 7, batchSize = 500 } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
  const candidates = await User.findAll({
    where: {
      must_reset_password: true,
      created_at: { [Op.lt]: cutoff }
    },
    attributes: ['id'],
    limit: batchSize
  })

  let deleted = 0
  for (const candidate of candidates) {
    const transaction = await sequelize.transaction()
    try {
      const orderCount = await Order.count({ where: { user_id: candidate.id }, transaction })
      if (orderCount > 0) {
        await transaction.rollback()
        continue
      }
      await Cart.destroy({ where: { user_id: candidate.id }, transaction })
      await User.destroy({ where: { id: candidate.id }, transaction })
      await transaction.commit()
      deleted++
    } catch (err) {
      await transaction.rollback().catch(() => {})
      logger.warn('清理游客空账号失败（已跳过）', { userId: candidate.id, err: err?.message })
    }
  }
  return deleted
}

export function startGuestAccountCleanup () {
  if (process.env.NODE_ENV === 'test') return null
  const intervalMs = Number(process.env.GUEST_ACCOUNT_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000)
  const timer = setInterval(() => {
    cleanupAbandonedGuestAccounts().catch((err) => {
      logger.error('游客空账号清理任务失败', { err: err?.message, stack: err?.stack })
    })
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}
