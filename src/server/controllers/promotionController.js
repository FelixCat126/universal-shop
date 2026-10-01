import Promotion from '../models/Promotion.js'
import { resolvePagination } from '../utils/pagination.js'
import { logger } from '../utils/logger.js'

/**
 * 促销管理（P1 营销体系 + P3 买多赠一）：threshold 满减 / buy_x_get_y 买赠
 * 入参由路由层 joi（promotionPayloadSchema / promotionStatusSchema）校验，此处只做存取
 */
class PromotionController {
  /** 后台：分页 + status/type 筛选 */
  static async list (req, res) {
    try {
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { maxPageSize: 100 })

      const where = {}
      if (['active', 'inactive'].includes(req.query.status)) {
        where.status = req.query.status
      }
      if (req.query.type) {
        where.type = String(req.query.type)
      }

      const { count, rows } = await Promotion.findAndCountAll({
        where,
        limit,
        offset,
        order: [['priority', 'DESC'], ['id', 'DESC']]
      })

      return res.json({
        success: true,
        data: {
          list: rows,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 0
        }
      })
    } catch (e) {
      logger.error('list promotions', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取促销列表失败' })
    }
  }

  static async create (req, res) {
    try {
      const { type, name, rules, scope, start_at, end_at, priority, status } = req.body
      const row = await Promotion.create({
        type,
        name,
        rules,
        scope,
        start_at: start_at || null,
        end_at: end_at || null,
        priority,
        status
      })
      return res.status(201).json({ success: true, data: row })
    } catch (e) {
      logger.error('create promotion', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '创建促销失败' })
    }
  }

  /** 全量替换（与创建同校验） */
  static async update (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await Promotion.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '促销不存在' })
      }
      const { type, name, rules, scope, start_at, end_at, priority, status } = req.body
      await row.update({
        type,
        name,
        rules,
        scope,
        start_at: start_at || null,
        end_at: end_at || null,
        priority,
        status
      })
      return res.json({ success: true, data: row })
    } catch (e) {
      logger.error('update promotion', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新促销失败' })
    }
  }

  static async updateStatus (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await Promotion.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '促销不存在' })
      }
      await row.update({ status: req.body.status })
      return res.json({ success: true, data: row })
    } catch (e) {
      logger.error('update promotion status', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新促销状态失败' })
    }
  }

  /** 硬删：已命中订单的金额以 order_promotions 快照为准，不受影响 */
  static async remove (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await Promotion.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '促销不存在' })
      }
      await row.destroy()
      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      logger.error('remove promotion', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '删除促销失败' })
    }
  }
}

export default PromotionController
