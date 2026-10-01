import sequelize from '../config/database.js'
import CouponTemplate from '../models/CouponTemplate.js'
import UserCoupon from '../models/UserCoupon.js'
import User from '../models/User.js'
import { resolvePagination } from '../utils/pagination.js'
import { logger } from '../utils/logger.js'

/**
 * 抵扣券模板管理（P2 营销体系）
 * 入参由路由层 joi（couponTemplatePayloadSchema / couponTemplateStatusSchema）校验，此处只做存取
 */
class CouponAdminController {
  /** 后台：分页 + status 筛选；每条带 issued_count / used_count 统计 */
  static async list (req, res) {
    try {
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { maxPageSize: 100 })

      const where = {}
      if (['active', 'inactive'].includes(req.query.status)) {
        where.status = req.query.status
      }

      const { count, rows } = await CouponTemplate.findAndCountAll({
        where,
        limit,
        offset,
        order: [['id', 'DESC']]
      })

      // 本页模板的发放/核销统计：两次 GROUP BY 聚合，避免逐行 COUNT 的 N+1
      const ids = rows.map(r => r.id)
      const issuedMap = new Map()
      const usedMap = new Map()
      if (ids.length > 0) {
        const aggregate = async (extraWhere) => UserCoupon.findAll({
          attributes: ['template_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          where: { template_id: ids, ...extraWhere },
          group: ['template_id'],
          raw: true
        })
        for (const r of await aggregate({})) {
          issuedMap.set(r.template_id, Number(r.cnt) || 0)
        }
        for (const r of await aggregate({ status: 'used' })) {
          usedMap.set(r.template_id, Number(r.cnt) || 0)
        }
      }

      const list = rows.map(r => ({
        ...r.toJSON(),
        issued_count: issuedMap.get(r.id) || 0,
        used_count: usedMap.get(r.id) || 0
      }))

      return res.json({
        success: true,
        data: {
          list,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 0
        }
      })
    } catch (e) {
      logger.error('list coupon templates', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取抵扣券模板列表失败' })
    }
  }

  static async create (req, res) {
    try {
      const { name, amount, min_spend, total, per_user, valid_from, valid_to, scope, register_gift, status } = req.body
      const row = await CouponTemplate.create({
        name,
        amount,
        min_spend,
        total,
        per_user,
        valid_from: valid_from || null,
        valid_to: valid_to || null,
        scope,
        register_gift,
        status
      })
      return res.status(201).json({ success: true, data: row })
    } catch (e) {
      logger.error('create coupon template', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '创建抵扣券模板失败' })
    }
  }

  /** 全量替换（与创建同校验） */
  static async update (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await CouponTemplate.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '抵扣券模板不存在' })
      }
      const { name, amount, min_spend, total, per_user, valid_from, valid_to, scope, register_gift, status } = req.body
      await row.update({
        name,
        amount,
        min_spend,
        total,
        per_user,
        valid_from: valid_from || null,
        valid_to: valid_to || null,
        scope,
        register_gift,
        status
      })
      return res.json({ success: true, data: row })
    } catch (e) {
      logger.error('update coupon template', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新抵扣券模板失败' })
    }
  }

  static async updateStatus (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await CouponTemplate.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '抵扣券模板不存在' })
      }
      await row.update({ status: req.body.status })
      return res.json({ success: true, data: row })
    } catch (e) {
      logger.error('update coupon template status', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新抵扣券模板状态失败' })
    }
  }

  /** 硬删：已有用户领取的模板拒绝删除（避免持券用户的券被级联清掉），可改为停用 */
  static async remove (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await CouponTemplate.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '抵扣券模板不存在' })
      }
      const issued = await UserCoupon.count({ where: { template_id: id } })
      if (issued > 0) {
        return res.status(400).json({ success: false, message: '该模板已有用户领取，不可删除，可改为停用' })
      }
      await row.destroy()
      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      logger.error('remove coupon template', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '删除抵扣券模板失败' })
    }
  }

  /** 模板实例列表：分页列出已发券（用户、code、status、时间） */
  static async instances (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const template = await CouponTemplate.findByPk(id)
      if (!template) {
        return res.status(404).json({ success: false, message: '抵扣券模板不存在' })
      }
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { maxPageSize: 100 })
      const { count, rows } = await UserCoupon.findAndCountAll({
        where: { template_id: id },
        include: [{ model: User, as: 'user', attributes: ['id', 'nickname', 'phone'] }],
        order: [['id', 'DESC']],
        limit,
        offset
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
      logger.error('list coupon instances', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取抵扣券实例列表失败' })
    }
  }
}

export default CouponAdminController
