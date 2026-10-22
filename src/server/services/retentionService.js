import { Op } from 'sequelize'
import AuditLog from '../models/AuditLog.js'
import OperationLog from '../models/OperationLog.js'
import { logger } from '../utils/logger.js'

/**
 * 审计数据保留策略：AuditLog 365 天，OperationLog 730 天。
 * 每日清理一次；支持直接调用用于测试和手动运维。
 */
export async function cleanupRetentionData ({ auditDays = 365, operationDays = 730, batchSize = 1000 } = {}) {
  const now = Date.now()
  const auditCutoff = new Date(now - auditDays * 86400000)
  const operationCutoff = new Date(now - operationDays * 86400000)

  const auditDeleted = await AuditLog.destroy({
    where: { created_at: { [Op.lt]: auditCutoff } },
    limit: batchSize
  })
  const operationDeleted = await OperationLog.destroy({
    where: { created_at: { [Op.lt]: operationCutoff } },
    limit: batchSize
  })
  return { auditDeleted, operationDeleted }
}

export function startRetentionCleanup () {
  if (process.env.NODE_ENV === 'test') return null
  const timer = setInterval(() => {
    cleanupRetentionData().catch((err) => {
      logger.error('审计数据保留清理失败', { err: err?.message, stack: err?.stack })
    })
  }, 24 * 60 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}
