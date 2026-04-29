import PointTransaction from '../models/PointTransaction.js'
import Order from '../models/Order.js'
import { applyCreatedBetween } from '../utils/dateFilters.js'
import * as pointsService from '../services/pointsService.js'

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
      console.error('读取积分余额失败:', error)
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

      const page = Math.max(Number.parseInt(String(req.query.page ?? '1'), 10) || 1, 1)
      const rawLimit = Number.parseInt(String(req.query.limit ?? '20'), 10) || 20
      const limit = Math.min(Math.max(rawLimit, 1), 100)
      const offset = (page - 1) * limit

      let where = { user_id: userId }
      where = applyCreatedBetween(where, req.query, { column: 'PointTransaction.created_at' })

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
      console.error('获取积分明细失败:', error)
      return res.status(500).json({
        success: false,
        message: '获取积分明细失败'
      })
    }
  }
}

export default PointsController
