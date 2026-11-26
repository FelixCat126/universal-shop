import { Op } from 'sequelize'
import Notification from '../models/Notification.js'
import { parseId } from '../utils/params.js'
import { resolvePagination } from '../utils/pagination.js'
import { respondDbError } from '../utils/dbInputError.js'
import { logger } from '../utils/logger.js'

/**
 * 站内通知控制器（第 54 轮）
 * ==========================
 *
 * 用户在这里看到"我的订单发货了""售后被驳回了""积分到账了"。
 *
 * **只读自己的通知**：所有查询都以 `req.user.userId` 为准，
 * 不接受"查别人的"参数 —— 否则改一下 id 就能看别人的通知。
 */
class NotificationController {
  /**
   * 列表：按未读/已读筛选 + 分页
   */
  static async list (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '请先登录' })
      }

      const { page, pageSize, limit, offset } = resolvePagination(req.query)
      const where = { user_id: userId }

      // 只读=true → 只看未读
      if (String(req.query.unreadOnly || '') === 'true') {
        where.is_read = false
      }

      const { count, rows } = await Notification.findAndCountAll({
        where,
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset
      })

      return res.json({
        success: true,
        data: {
          notifications: rows.map((r) => r.toJSON()),
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 1
        }
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '查询通知列表失败',
        fallbackMessage: '查询通知失败',
        logger
      })
    }
  }

  /**
   * 未读数（铃铛角标）：单独一个轻量接口，避免为了一个数字拉整页列表。
   */
  static async unreadCount (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '请先登录' })
      }
      const count = await Notification.count({ where: { user_id: userId, is_read: false } })
      return res.json({ success: true, data: { unread: count } })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '统计未读通知失败',
        fallbackMessage: '查询未读通知失败',
        logger
      })
    }
  }

  /**
   * 标记单条已读
   */
  static async markRead (req, res) {
    try {
      const userId = req.user?.userId
      const id = parseId(req.params.id)
      if (!userId) {
        return res.status(401).json({ success: false, message: '请先登录' })
      }
      if (!id) {
        return res.status(400).json({ success: false, message: '无效的通知 ID' })
      }

      // where 里带 user_id → 别人的通知改不动（404 而不是 403，不泄露存在性）
      const [updated] = await Notification.update(
        { is_read: true, read_at: new Date() },
        { where: { id, user_id: userId, is_read: false } }
      )
      if (!updated) {
        // 可能是"本来就是已读"或"不存在" —— 都按幂等成功处理
        const exists = await Notification.count({ where: { id, user_id: userId } })
        if (!exists) {
          return res.status(404).json({ success: false, message: '通知不存在' })
        }
      }
      return res.json({ success: true, message: '已标记为已读' })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '标记通知已读失败',
        fallbackMessage: '标记通知已读失败',
        logger
      })
    }
  }

  /**
   * 全部标记已读
   */
  static async markAllRead (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '请先登录' })
      }
      const [updated] = await Notification.update(
        { is_read: true, read_at: new Date() },
        { where: { user_id: userId, is_read: false } }
      )
      return res.json({ success: true, message: '已全部标记为已读', data: { updated } })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '全部标记已读失败',
        fallbackMessage: '全部标记已读失败',
        logger
      })
    }
  }
}

export default NotificationController
