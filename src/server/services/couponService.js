/**
 * 抵扣券服务（P2 营销体系）：领券与注册赠券的统一收口
 *
 * 并发设计：
 *   - 领券在事务内对模板行加 FOR UPDATE 锁，总量/每人限领判定与发券串行化，防并发超发；
 *   - 券码（CP + 10 位大写随机）撞唯一约束时按 SAVEPOINT 模式重试（最多 3 次），
 *     与 createOrder 订单号重试同一套路（PG 报错后整事务 aborted，必须回滚到保存点）；
 *   - 事务整体包 withDeadlockRetry：40P01/40001 时重建事务整体重跑（fn 可重入）；
 *     业务校验错误（status=400）与其余非死锁错误原样上抛、不触发重试；
 *   - 注册赠券逐模板独立发放，单模板失败只记日志、不影响注册主流程与其他模板。
 */

import { Op } from 'sequelize'
import crypto from 'crypto'
import sequelize from '../config/database.js'
import CouponTemplate from '../models/CouponTemplate.js'
import UserCoupon from '../models/UserCoupon.js'
import { withDeadlockRetry } from '../utils/dbRetry.js'
import { logger } from '../utils/logger.js'

/** 券码字母表：大写字母+数字（10 位空间 36^10，碰撞概率极低，唯一约束+重试兜底） */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** 生成券码：CP + 10 位大写随机 */
export function generateCouponCode () {
  const bytes = crypto.randomBytes(10)
  let s = ''
  for (let i = 0; i < 10; i++) {
    s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return `CP${s}`
}

/** 业务校验错误：带 status=400，控制器据此返回 400 而非 500 */
function businessError (message) {
  const err = new Error(message)
  err.status = 400
  return err
}

/** PG 唯一约束冲突判定（口径与 orderController.isUniqueViolationError 一致） */
function isUniqueViolationError (err) {
  return err?.name === 'SequelizeUniqueConstraintError' ||
    err?.parent?.code === '23505' ||
    err?.original?.code === '23505'
}

/**
 * 为指定用户领取 1 张券（自带事务；校验失败抛 status=400 的业务错误）
 * 事务在 withDeadlockRetry 的 fn 内创建：40P01/40001 时自动重建事务重跑；
 * 保存点内吞掉的券码 23505 不外溢，businessError（status=400）不带 PG 错误码、不触发重试
 * @param {{ templateId: number, userId: number, checkPerUser?: boolean }} param0
 *   checkPerUser=false 仅用于注册赠券（每新用户一次，跳过每人限领；总量检查保留）
 * @returns {Promise<UserCoupon>} 创建成功的券实例
 */
export async function claimCouponForUser ({ templateId, userId, checkPerUser = true }) {
  return withDeadlockRetry(async () => {
    const transaction = await sequelize.transaction()
    try {
      // 模板行锁：总量/每人限领的"查-写"在同一事务串行化，并发下不超发
      const template = await CouponTemplate.findByPk(templateId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      })
      if (!template || template.status !== 'active') {
        throw businessError('该抵扣券不存在或已停用')
      }
      const now = new Date()
      if (template.valid_from && new Date(template.valid_from) > now) {
        throw businessError('该抵扣券尚未开始领取')
      }
      if (template.valid_to && new Date(template.valid_to) < now) {
        throw businessError('该抵扣券已过有效期，无法领取')
      }
      if (checkPerUser) {
        // 每人限领按历史领取总量计（含已用/已过期），防止反复领用同一模板
        const mineCount = await UserCoupon.count({
          where: { template_id: template.id, user_id: userId },
          transaction
        })
        if (mineCount >= (template.per_user || 1)) {
          throw businessError('您已达到该抵扣券的领取上限')
        }
      }
      if (template.total != null) {
        const issuedCount = await UserCoupon.count({
          where: { template_id: template.id },
          transaction
        })
        if (issuedCount >= template.total) {
          throw businessError('该抵扣券已被领完')
        }
      }

      // 券码唯一冲突重试（最多 3 次，SAVEPOINT 模式，同 createOrder 订单号重试）
      let coupon = null
      let tries = 0
      while (tries < 3 && !coupon) {
        const sp = await sequelize.transaction({ transaction })
        try {
          coupon = await UserCoupon.create({
            template_id: template.id,
            user_id: userId,
            code: generateCouponCode(),
            status: 'unused',
            expire_at: template.valid_to || null
          }, { transaction: sp })
          await sp.commit()
        } catch (err) {
          await sp.rollback().catch(() => {})
          if (isUniqueViolationError(err)) {
            tries++
            continue
          }
          throw err
        }
      }
      if (!coupon) {
        throw new Error('生成券码失败，请稍后重试')
      }

      await transaction.commit()
      return coupon
    } catch (err) {
      await transaction.rollback().catch(() => {})
      throw err
    }
  })
}

/**
 * 注册赠券：对 register_gift=true 且 active 且在有效期的模板各发 1 张。
 * 仅在新用户创建成功后调用（复用既有账号的路径不发）；跳过每人限领、保留总量检查；
 * 单模板失败只记日志，不影响注册与其他模板发放。
 */
export async function grantRegisterGiftCoupons (userId) {
  const now = new Date()
  const templates = await CouponTemplate.findAll({
    where: {
      register_gift: true,
      status: 'active',
      [Op.and]: [
        { [Op.or]: [{ valid_from: null }, { valid_from: { [Op.lte]: now } }] },
        { [Op.or]: [{ valid_to: null }, { valid_to: { [Op.gte]: now } }] }
      ]
    }
  })
  for (const template of templates) {
    try {
      await claimCouponForUser({ templateId: template.id, userId, checkPerUser: false })
    } catch (err) {
      logger.warn('注册赠券发放失败（已跳过该模板）', {
        userId,
        templateId: template.id,
        err: err?.message
      })
    }
  }
}
