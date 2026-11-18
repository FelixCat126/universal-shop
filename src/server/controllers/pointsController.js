import PointTransaction from '../models/PointTransaction.js'
import Order from '../models/Order.js'
import { applyCreatedBetween } from '../utils/dateFilters.js'
import { resolvePagination } from '../utils/pagination.js'
import { getBusinessTimezone } from '../utils/businessTimezone.js'
import * as pointsService from '../services/pointsService.js'
import { logger } from '../utils/logger.js'

class PointsController {
  static async getBalance (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' })
      }
      const balance = await pointsService.getBalance(userId)
      return res.json({
        success: true,
        data: { balance }
      })
    } catch (error) {
      logger.error('读取积分余额失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '读取积分余额失败'
      })
    }
  }

  static async listTransactions (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' })
      }

      // 统一走 resolvePagination：page 也必须有上限（否则深翻页会把 OFFSET
      // 打到近亿，PG 顺序扫全表 + COUNT(*) = 两次全表扫描）。
      const { page, limit, offset } = resolvePagination(
        req.query,
        { pageSizeKey: 'limit', defaultPageSize: 20, maxPageSize: 100 }
      )

      let where = { user_id: userId }
      where = applyCreatedBetween(where, req.query, {
        column: 'PointTransaction.created_at',
        timezone: await getBusinessTimezone()
      })

      const { count, rows } = await PointTransaction.findAndCountAll({
        where,
        order: [['created_at', 'DESC']],
        limit,
        offset,
        include: [{
          model: Order,
          as: 'order',
          attributes: ['id', 'order_no'],
          required: false
        }]
      })

      return res.json({
        success: true,
        data: {
          items: rows,
          total: count,
          page,
          totalPages: Math.ceil(count / limit) || 0
        }
      })
    } catch (error) {
      logger.error('获取积分明细失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '获取积分明细失败'
      })
    }
  }
}

export default PointsController
