/**
 * 站内通知服务（第 54 轮）
 * =========================
 *
 * ## 设计原则：通知失败**绝不能**影响业务动作
 *
 * 典型的坑：运营改订单状态 → 事务提交 → 写通知时抛错 →
 * 接口返回 500 → 运营以为改失败了 → 又点一次 → 状态被改两次。
 *
 * 所以这里的写通知一律**吞掉异常**并记日志：
 * 业务已经成功了就必须返回成功，通知只是"尽力而为"的附加动作。
 *
 * 这与 AuditLog.record 是同一个思路（它也是 best-effort）。
 *
 * ## 为什么用**独立事务**
 *
 * 业务事务已经 commit 了，通知如果复用那个事务就晚了；
 * 而如果把通知塞进业务事务的前半段，通知失败又会拖垮业务。
 * 所以：业务事务提交后，用**独立连接**写通知，失败只记日志。
 */
import Notification from '../models/Notification.js'
import { logger } from '../utils/logger.js'

/**
 * 给用户发一条站内通知（best-effort，永不抛错）。
 *
 * @param {object} opts
 * @param {number|null} opts.userId 接收人；null/无效则**跳过**（不写库）
 * @param {string} opts.type     通知类型（见 NOTIFICATION_TYPES）
 * @param {object} [opts.data]   渲染所需结构化数据（订单号/商品名/金额…）
 * @param {string} [opts.link]   站内跳转地址
 * @returns {Promise<object|null>} 成功返回通知行，失败/跳过返回 null
 */
export async function notifyUser ({ userId, type, data = null, link = null }) {
  if (!userId || !type) return null
  try {
    return await Notification.create({
      user_id: userId,
      type,
      data,
      link,
      is_read: false
    })
  } catch (error) {
    // 通知写失败**不影响业务**（业务可能已经提交了）
    logger.error('写站内通知失败（不影响主流程）', {
      userId,
      type,
      err: error?.message
    })
    return null
  }
}

/**
 * 批量给多个用户发同一条通知（如：运营定向发券）。
 *
 * @param {object} opts
 * @param {number[]} opts.userIds
 * @param {string} opts.type
 * @param {object} [opts.data]
 * @param {string} [opts.link]
 * @returns {Promise<number>} 成功写入条数
 */
export async function notifyUsers ({ userIds, type, data = null, link = null }) {
  const ids = (userIds || []).map(Number).filter(Number.isInteger)
  if (!ids.length) return 0
  try {
    const rows = ids.map(id => ({
      user_id: id,
      type,
      data,
      link,
      is_read: false
    }))
    const created = await Notification.bulkCreate(rows)
    return created.length
  } catch (error) {
    logger.error('批量写站内通知失败（不影响主流程）', {
      count: ids.length,
      type,
      err: error?.message
    })
    return 0
  }
}

/**
 * 读取某用户未读通知数（铃铛角标）。
 * @param {number} userId
 * @returns {Promise<number>}
 */
export async function countUnread (userId) {
  if (!userId) return 0
  try {
    return await Notification.count({ where: { user_id: userId, is_read: false } })
  } catch (error) {
    logger.error('统计未读通知失败', { userId, err: error?.message })
    return 0
  }
}
