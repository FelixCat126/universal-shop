import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import CouponTemplate from '../models/CouponTemplate.js'
import UserCoupon from '../models/UserCoupon.js'
import { claimCouponForUser } from '../services/couponService.js'
import { logger } from '../utils/logger.js'

/** 券实例 + 模板字段拍平（mine/claim 共用的输出契约） */
function flattenUserCoupon (coupon) {
  const t = coupon.template
  return {
    id: coupon.id,
    template_id: coupon.template_id,
    code: coupon.code,
    status: coupon.status,
    expire_at: coupon.expire_at,
    used_at: coupon.used_at,
    used_by_order_id: coupon.used_by_order_id,
    created_at: coupon.created_at,
    name: t?.name ?? null,
    amount: t ? Number(t.amount) : null,
    min_spend: t ? Number(t.min_spend) : null,
    scope: t?.scope ?? null
  }
}

/**
 * 用户端抵扣券（P2 营销体系）：可领列表 / 领取 / 我的券
 * 路由层已挂 authenticateToken，req.user.userId 必有
 */
class CouponController {
  /**
   * 可领取模板列表：active、在有效期、未超总量、未达我的 per_user；
   * 每项附 remaining（NULL=不限）与 claimed_by_me
   */
  static async available (req, res) {
    try {
      const userId = req.user.userId
      const now = new Date()

      const templates = await CouponTemplate.findAll({
        where: {
          status: 'active',
          [Op.and]: [
            { [Op.or]: [{ valid_from: null }, { valid_from: { [Op.lte]: now } }] },
            { [Op.or]: [{ valid_to: null }, { valid_to: { [Op.gte]: now } }] }
          ]
        },
        order: [['id', 'DESC']]
      })

      // 批量统计：各模板已发总量 + 我领取量（两次 GROUP BY，避免逐模板 COUNT 的 N+1）
      const ids = templates.map(t => t.id)
      const issuedMap = new Map()
      const mineMap = new Map()
      if (ids.length > 0) {
        const issuedRows = await UserCoupon.findAll({
          attributes: ['template_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          where: { template_id: ids },
          group: ['template_id'],
          raw: true
        })
        for (const r of issuedRows) issuedMap.set(r.template_id, Number(r.cnt) || 0)
        const mineRows = await UserCoupon.findAll({
          attributes: ['template_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          where: { template_id: ids, user_id: userId },
          group: ['template_id'],
          raw: true
        })
        for (const r of mineRows) mineMap.set(r.template_id, Number(r.cnt) || 0)
      }

      const list = []
      for (const t of templates) {
        const issued = issuedMap.get(t.id) || 0
        const claimedByMe = mineMap.get(t.id) || 0
        const remaining = t.total == null ? null : Math.max(0, t.total - issued)
        if (remaining !== null && remaining <= 0) continue
        if (claimedByMe >= (t.per_user || 1)) continue
        list.push({
          id: t.id,
          name: t.name,
          amount: Number(t.amount),
          min_spend: Number(t.min_spend),
          scope: t.scope,
          valid_from: t.valid_from,
          valid_to: t.valid_to,
          remaining,
          claimed_by_me: claimedByMe
        })
      }

      return res.json({ success: true, data: { list } })
    } catch (e) {
      logger.error('list available coupons', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取可领取抵扣券失败' })
    }
  }

  /** 领取：业务校验（停用/超期/超总量/超每人限领）由 couponService 抛 400 */
  static async claim (req, res) {
    try {
      const userId = req.user.userId
      const { template_id } = req.body
      const coupon = await claimCouponForUser({ templateId: template_id, userId })
      const full = await UserCoupon.findByPk(coupon.id, {
        include: [{ model: CouponTemplate, as: 'template' }]
      })
      return res.status(201).json({ success: true, data: flattenUserCoupon(full) })
    } catch (e) {
      if (e && e.status === 400) {
        return res.status(400).json({ success: false, message: e.message })
      }
      logger.error('claim coupon', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '领取抵扣券失败' })
    }
  }

  /**
   * 我的券：?status=unused|used|expired 过滤；
   * 查询前惰性过期（expire_at 已过且仍 unused → 置 expired），无需定时任务
   */
  static async mine (req, res) {
    try {
      const userId = req.user.userId
      const now = new Date()

      await UserCoupon.update(
        { status: 'expired' },
        {
          where: {
            user_id: userId,
            status: 'unused',
            expire_at: { [Op.ne]: null, [Op.lt]: now }
          }
        }
      )

      const where = { user_id: userId }
      if (['unused', 'used', 'expired'].includes(req.query.status)) {
        where.status = req.query.status
      }

      const rows = await UserCoupon.findAll({
        where,
        include: [{ model: CouponTemplate, as: 'template' }],
        order: [['id', 'DESC']],
        // 安全上限：防无上限 findAll（单用户券量正常远小于该值）
        limit: 1000
      })

      return res.json({
        success: true,
        data: { list: rows.map(flattenUserCoupon) }
      })
    } catch (e) {
      logger.error('list my coupons', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取我的抵扣券失败' })
    }
  }
}

export default CouponController
