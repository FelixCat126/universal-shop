import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import User from '../models/User.js'
import UserPointBalance from '../models/UserPointBalance.js'
import PointTransaction from '../models/PointTransaction.js'
import * as pointsService from '../services/pointsService.js'
import { resolvePagination } from '../utils/pagination.js'
import { likeContains } from '../utils/likeSearch.js'
import { parseId, parseStrictInt } from '../utils/params.js'
import { withDeadlockRetry } from '../utils/dbRetry.js'
import { logger } from '../utils/logger.js'

/**
 * 单次手工调整的积分上限。
 *
 * 积分是"钱"：一次调整 100 万积分意味着直接改了用户资产。
 * 业务上运营的补偿/纠错都是小数目，设个上限既能挡住误操作（手滑填了 10 万），
 * 也能挡住积分列（INTEGER，上限 21 亿）的溢出。
 */
const MAX_ADJUST_DELTA = 1_000_000

/** 备注长度上限（与 PointTransaction.note 字段长度一致） */
const MAX_NOTE_LENGTH = 255

class AdminPointsController {
  /**
   * 全局积分概览：用户数 / 总余额 / 总发放 / 总消耗。
   *
   * 口径说明（页面上要写清楚，避免运营对着数字对不上）：
   *   - 总余额 = user_point_balances.balance 之和（**权威余额**，不是流水累加）
   *   - 总发放 / 总消耗 = 现存积分流水里正/负 delta 之和
   *   - 已被 retention 清理掉的旧流水（>730 天）不计入发放/消耗，
   *     其净额记在余额行的 archived_delta 里 —— 余额仍然准确，只是历史统计不完整。
   */
  static async getOverview (req, res) {
    try {
      const [balanceAgg, grantAgg, consumeAgg, txCount] = await Promise.all([
        UserPointBalance.findOne({
          attributes: [
            [sequelize.fn('COUNT', sequelize.col('user_id')), 'users_count'],
            [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('balance')), 0), 'total_balance']
          ],
          raw: true
        }),
        PointTransaction.findOne({
          attributes: [
            [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('delta')), 0), 'total_granted']
          ],
          where: { delta: { [Op.gt]: 0 } },
          raw: true
        }),
        PointTransaction.findOne({
          attributes: [
            [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('delta')), 0), 'total_consumed']
          ],
          where: { delta: { [Op.lt]: 0 } },
          raw: true
        }),
        PointTransaction.count()
      ])

      return res.json({
        success: true,
        data: {
          // 有积分账户（余额行）的用户数
          totalUsers: Number(balanceAgg?.users_count) || 0,
          // 余额合计
          totalBalance: Number(balanceAgg?.total_balance) || 0,
          // 累计发放 / 累计消耗（消耗取绝对值，页面显示的是"花掉多少"）
          totalGranted: Number(grantAgg?.total_granted) || 0,
          totalConsumed: Math.abs(Number(consumeAgg?.total_consumed) || 0),
          // 现存流水条数
          transactionCount: Number(txCount) || 0
        }
      })
    } catch (error) {
      logger.error('获取积分概览失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '获取积分概览失败' })
    }
  }

  /**
   * 用户积分余额列表（分页 + 筛选）。
   *
   * 筛选：
   *   - user_id     精确匹配
   *   - keyword     手机号 / 昵称 / 用户名 模糊匹配（数字时同时匹配用户 id）
   *   - min_balance / max_balance  余额区间
   */
  static async listUserBalances (req, res) {
    try {
      // 统一走 resolvePagination：page 也必须有上限（深翻页会把 OFFSET 打到近亿）
      const { page, pageSize, limit, offset } = resolvePagination(req.query, {
        defaultPageSize: 20,
        maxPageSize: 100
      })

      const conditions = []

      const userIdParam = parseStrictInt(req.query.user_id)
      if (userIdParam !== null) {
        conditions.push({ user_id: userIdParam })
      }

      const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : ''
      if (keyword) {
        const like = likeContains(keyword)
        const userParts = [
          { '$user.nickname$': { [Op.like]: like } },
          { '$user.username$': { [Op.like]: like } },
          { '$user.phone$': { [Op.like]: like } }
        ]
        // 数字关键字同时当作用户 id 匹配（运营手里常只有 id）
        const asId = parseStrictInt(keyword)
        if (asId !== null) userParts.push({ '$user.id$': { [Op.eq]: asId } })
        conditions.push({ [Op.or]: userParts })
      }

      const minBalance = parseStrictInt(req.query.min_balance)
      const maxBalance = parseStrictInt(req.query.max_balance)
      if (minBalance !== null || maxBalance !== null) {
        const range = {}
        if (minBalance !== null) range[Op.gte] = minBalance
        if (maxBalance !== null) range[Op.lte] = maxBalance
        conditions.push({ balance: range })
      }

      const where = conditions.length ? { [Op.and]: conditions } : {}

      const { count, rows } = await UserPointBalance.findAndCountAll({
        where,
        include: [{
          model: User,
          as: 'user',
          required: true,
          attributes: ['id', 'nickname', 'username', 'phone', 'country_code', 'email']
        }],
        // belongsTo 一对一连接不会放大行数，关掉子查询让 limit 精确作用在余额行上
        subQuery: false,
        order: [['balance', 'DESC'], ['user_id', 'DESC']],
        limit,
        offset
      })

      const items = rows.map(row => ({
        user_id: row.user_id,
        balance: Number(row.balance) || 0,
        archived_delta: Number(row.archived_delta) || 0,
        updated_at: row.updated_at,
        user: row.user
          ? {
            id: row.user.id,
            nickname: row.user.nickname,
            username: row.user.username,
            phone: row.user.phone,
            country_code: row.user.country_code,
            email: row.user.email
          }
          : null
      }))

      return res.json({
        success: true,
        data: {
          items,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 0
        }
      })
    } catch (error) {
      logger.error('获取用户积分余额列表失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '获取用户积分余额列表失败' })
    }
  }

  /** 某个用户的积分流水（分页） */
  static async listUserTransactions (req, res) {
    try {
      const userId = parseId(req.params.userId)
      if (!userId) {
        return res.status(400).json({ success: false, message: '无效的用户 ID' })
      }

      const { page, pageSize, limit, offset } = resolvePagination(req.query, {
        defaultPageSize: 20,
        maxPageSize: 100
      })

      const { count, rows } = await PointTransaction.findAndCountAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset
      })

      return res.json({
        success: true,
        data: {
          items: rows,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 0
        }
      })
    } catch (error) {
      logger.error('获取用户积分流水失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '获取用户积分流水失败' })
    }
  }

  /**
   * 手工发放/扣减积分。
   *
   * 硬性要求（照做，别偷懒）：
   *   - 必须在事务里：余额行用 pointsService.lockOrCreateBalance 加锁（FOR UPDATE），
   *     否则与「下单返积分」「换购扣积分」并发时会互相覆盖余额；
   *   - 用 withDeadlockRetry 包住整段事务：死锁/串行化冲突时整段重跑；
   *   - 余额不能变负：不足直接 400（余额保持不变，事务回滚）；
   *   - 必须写一条流水（type=admin_adjust），balance_after 记变动后的余额。
   */
  static async adjustUserPoints (req, res) {
    const userId = parseId(req.params.userId)
    if (!userId) {
      return res.status(400).json({ success: false, message: '无效的用户 ID' })
    }

    const delta = parseStrictInt(req.body?.delta)
    if (delta === null || delta === 0) {
      return res.status(400).json({ success: false, message: '积分调整值必须是非零整数（正数发放，负数扣减）' })
    }
    if (Math.abs(delta) > MAX_ADJUST_DELTA) {
      return res.status(400).json({
        success: false,
        message: `单次积分调整不得超过 ${MAX_ADJUST_DELTA}，请分次操作`
      })
    }

    const note = String(req.body?.note ?? '').trim()
    if (note.length > MAX_NOTE_LENGTH) {
      return res.status(400).json({ success: false, message: `备注长度不得超过 ${MAX_NOTE_LENGTH} 个字符` })
    }

    try {
      const user = await User.findByPk(userId, { attributes: ['id', 'nickname'] })
      if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      const result = await withDeadlockRetry(
        () => sequelize.transaction((transaction) =>
          pointsService.adjustPointsManually(transaction, {
            userId,
            delta,
            note: note || '管理员手工调整积分'
          })
        ),
        { label: 'admin.points.adjust' }
      )

      logger.info('管理端手工调整积分', {
        userId,
        delta,
        admin: req.admin?.username,
        balanceAfter: result.balance_after
      })

      return res.json({
        success: true,
        message: delta > 0 ? '积分发放成功' : '积分扣减成功',
        data: {
          user_id: userId,
          delta,
          balance_before: result.balance_before,
          balance_after: result.balance_after
        }
      })
    } catch (error) {
      if (error?.code === 'POINTS_INSUFFICIENT' || error?.message === 'POINTS_INSUFFICIENT') {
        return res.status(400).json({
          success: false,
          code: 'POINTS_INSUFFICIENT',
          message: '积分余额不足，无法扣减'
        })
      }
      logger.error('手工调整积分失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '手工调整积分失败' })
    }
  }
}

export default AdminPointsController
