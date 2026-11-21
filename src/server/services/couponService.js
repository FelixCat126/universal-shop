/**
 * 抵扣券服务（P2 营销体系）：领券、注册赠券与管理端定向发券的统一收口
 *
 * 并发设计：
 *   - 发券在事务内对模板行加 FOR UPDATE 锁，总量/每人限领判定与发券串行化，防并发超发；
 *   - 券码（CP + 10 位大写随机）撞唯一约束时按 SAVEPOINT 模式重试（最多 3 次），
 *     与 createOrder 订单号重试同一套路（PG 报错后整事务 aborted，必须回滚到保存点）；
 *   - 事务整体包 withDeadlockRetry：40P01/40001 时重建事务整体重跑（fn 可重入）；
 *     业务校验错误（status=400）与其余非死锁错误原样上抛、不触发重试；
 *   - 注册赠券逐模板独立发放，单模板失败只记日志、不影响注册主流程与其他模板。
 *
 * ## 为什么定向发券要复用这里的逻辑
 *
 * 管理端「定向发券」（补偿 / 活动 / 老客户维护）与用户自助领券，
 * 在**总量上限**、**每人限领**、**券码唯一性**这三件事上是同一套业务规则。
 * 各写一套判定迟早会漂移（典型症状：用户自己能领 3 张，运营发第 2 张就被拒，
 * 或者运营发券绕过了总量上限，把模板超发）—— 这种偏差极难在事后被发现。
 * 所以下面把「判定」与「发券」抽成 assertIssuable / issueCoupon 两个函数，
 * 自助领券（claimCouponForUser）与定向发券（grantCouponsToUsers）都走它们。
 */

import { Op } from 'sequelize'
import crypto from 'crypto'
import sequelize from '../config/database.js'
import CouponTemplate from '../models/CouponTemplate.js'
import UserCoupon from '../models/UserCoupon.js'
import User from '../models/User.js'
import { withDeadlockRetry } from '../utils/dbRetry.js'
import { logger } from '../utils/logger.js'

/** 券码字母表：大写字母+数字（10 位空间 36^10，碰撞概率极低，唯一约束+重试兜底） */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** 业务错误码：让调用方能区分「限领触顶」与「总量发完」，好翻译成不同文案 */
export const COUPON_LIMIT_PER_USER = 'COUPON_PER_USER_LIMIT'
export const COUPON_LIMIT_TOTAL = 'COUPON_TOTAL_LIMIT'

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
function businessError (message, code) {
  const err = new Error(message)
  err.status = 400
  if (code) err.code = code
  return err
}

/** PG 唯一约束冲突判定（口径与 orderController.isUniqueViolationError 一致） */
function isUniqueViolationError (err) {
  return err?.name === 'SequelizeUniqueConstraintError' ||
    err?.parent?.code === '23505' ||
    err?.original?.code === '23505'
}

/**
 * 取模板行并加 FOR UPDATE 锁。
 *
 * 锁模板行而不是锁券实例行：所有发券路径（自助领券 / 注册赠券 / 定向发券）
 * 都要按同一模板的总量与限领判定，加同一把行锁才能把「查-写」串行化，
 * 否则两个并发领券请求各自读到旧计数 → 超发。
 */
async function lockTemplate (templateId, transaction) {
  return CouponTemplate.findByPk(templateId, {
    transaction,
    lock: transaction.LOCK.UPDATE
  })
}

/**
 * 有效期判定（自助领券与定向发券共用）。
 * @param {object} template 模板行
 * @param {{ notStarted?: string, expired?: string }} [messages] 自定义文案
 */
function assertWithinValidity (template, messages = {}) {
  const now = new Date()
  if (template.valid_from && new Date(template.valid_from) > now) {
    throw businessError(messages.notStarted || '该抵扣券尚未开始领取')
  }
  if (template.valid_to && new Date(template.valid_to) < now) {
    throw businessError(messages.expired || '该抵扣券已过有效期，无法领取')
  }
}

/**
 * 发券资格判定（**唯一一份**总量/限领口径）。
 *
 * 两条规则：
 *   1. 每人限领：按历史领取总量计（含已用/已过期/已作废），防止反复领用同一模板；
 *   2. 发行总量：模板已发张数（含本批次内先发出的）不得超过 total。
 *
 * @param {object} param0
 * @param {object} param0.template 模板行（调用方需已持锁）
 * @param {number} param0.userId 目标用户
 * @param {object} param0.transaction 事务
 * @param {boolean} [param0.checkPerUser] 是否校验每人限领（注册赠券跳过）
 * @param {number} [param0.batchIssued] 本批次内先于当前用户发出的张数
 *   （同一批里后面的用户也要占总量，判定时必须把它算进去，
 *   否则「总量只剩 1 张却发了 3 个用户」会被放行）
 */
async function assertIssuable ({ template, userId, transaction, checkPerUser = true, batchIssued = 0 }) {
  if (checkPerUser) {
    const mineCount = await UserCoupon.count({
      where: { template_id: template.id, user_id: userId },
      transaction
    })
    if (mineCount >= (template.per_user || 1)) {
      throw businessError('您已达到该抵扣券的领取上限', COUPON_LIMIT_PER_USER)
    }
  }
  if (template.total != null) {
    const issuedCount = await UserCoupon.count({
      where: { template_id: template.id },
      transaction
    })
    if (issuedCount + batchIssued >= template.total) {
      throw businessError('该抵扣券已被领完', COUPON_LIMIT_TOTAL)
    }
  }
}

/**
 * 落库一张券（券码唯一冲突时按 SAVEPOINT 模式重试，最多 3 次）。
 *
 * 必须走 SAVEPOINT：PG 里唯一约束冲突会把**整个事务**置为 aborted，
 * 不回滚到保存点的话，外层事务后续的语句全部报 25P02。
 */
async function issueCoupon ({ template, userId, transaction }) {
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
  return coupon
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
      const template = await lockTemplate(templateId, transaction)
      if (!template || template.status !== 'active') {
        throw businessError('该抵扣券不存在或已停用')
      }
      assertWithinValidity(template)
      await assertIssuable({ template, userId, transaction, checkPerUser })
      const coupon = await issueCoupon({ template, userId, transaction })
      await transaction.commit()
      return coupon
    } catch (err) {
      await transaction.rollback().catch(() => {})
      throw err
    }
  })
}

/**
 * 管理端定向发券：给一批指定用户各发 1 张券（补偿 / 活动 / 老客户维护）。
 *
 * 与自助领券的口径完全一致（同一份 assertIssuable / issueCoupon）：
 *   - 模板必须存在且 status='active'（停用/未生效的模板不能发）；
 *   - 总量上限与每人限领都按模板配置判定，触顶时**整批 400、一张都不发**
 *     （半发半不发的糊涂账比直接失败更难对账）；
 *   - 券码唯一冲突用 SAVEPOINT 模式重试，与自助领券同一套路。
 *
 * 与自助领券的差别只有一处：**目标用户不存在**不算触顶，只把该用户记进
 * failed 明细（运营一次可能贴错一个 id，不该让其余用户都拿不到券）。
 *
 * @param {{ templateId: number, userIds: number[], note?: string }} param0
 * @returns {Promise<{ granted: Array<{user_id:number,coupon_id:number,code:string}>, failed: Array<{user_id:number,message:string}> }>}
 */
export async function grantCouponsToUsers ({ templateId, userIds, note }) {
  return withDeadlockRetry(async () => {
    const transaction = await sequelize.transaction()
    try {
      const template = await lockTemplate(templateId, transaction)
      if (!template) {
        throw businessError('该抵扣券模板不存在')
      }
      if (template.status !== 'active') {
        throw businessError('该抵扣券模板已停用，无法发放')
      }
      assertWithinValidity(template, {
        notStarted: '该抵扣券模板尚未到生效时间，无法发放',
        expired: '该抵扣券模板已过有效期，无法发放'
      })

      // 去重：同一个用户重复传只发一张（否则会白吃用户的限领额度）
      const requested = [...new Set((userIds || []).map(Number).filter(Number.isInteger))]

      // 目标用户是否存在：一次查完（避免逐个查的 N+1）
      const existingRows = requested.length > 0
        ? await User.findAll({
          where: { id: { [Op.in]: requested } },
          attributes: ['id'],
          transaction
        })
        : []
      const existingIds = new Set(existingRows.map(r => r.id))
      const failed = []
      const targets = []
      for (const userId of requested) {
        if (existingIds.has(userId)) {
          targets.push(userId)
        } else {
          failed.push({ user_id: userId, message: '用户不存在' })
        }
      }

      // 预检：任一用户触碰到量/限领 → 整批失败（此阶段不产生任何写入）
      for (let i = 0; i < targets.length; i++) {
        const userId = targets[i]
        try {
          await assertIssuable({ template, userId, transaction, batchIssued: i })
        } catch (err) {
          throw toGrantLimitError(err, { userId, template, count: targets.length })
        }
      }

      const granted = []
      for (const userId of targets) {
        const coupon = await issueCoupon({ template, userId, transaction })
        granted.push({ user_id: userId, coupon_id: coupon.id, code: coupon.code })
      }

      await transaction.commit()
      return { granted, failed, note: note || null }
    } catch (err) {
      await transaction.rollback().catch(() => {})
      throw err
    }
  })
}

/**
 * 把「限领/限量」的业务错误翻译成管理端文案。
 * 自助领券的文案是给用户看的（"您已达到…"），管理端要看到**哪个用户**、**多少张**。
 */
function toGrantLimitError (err, { userId, template, count }) {
  if (err?.code === COUPON_LIMIT_PER_USER) {
    return businessError(
      `用户 ${userId} 已达到该券模板的每人限领上限（${template.per_user || 1} 张）`,
      COUPON_LIMIT_PER_USER
    )
  }
  if (err?.code === COUPON_LIMIT_TOTAL) {
    return businessError(
      `该券模板发行总量不足（总量 ${template.total} 张，本次需要发放 ${count} 张）`,
      COUPON_LIMIT_TOTAL
    )
  }
  return err
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
