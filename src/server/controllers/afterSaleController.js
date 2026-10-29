import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import AfterSale from '../models/AfterSale.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import PointTransaction from '../models/PointTransaction.js'
import UserPointBalance from '../models/UserPointBalance.js'
import { restoreOrderResources } from './orderController.js'
import { logger } from '../utils/logger.js'
import { parseId } from '../utils/params.js'
import { withDeadlockRetry } from '../utils/dbRetry.js'

const REQUESTABLE_STATUSES = ['paid', 'shipping', 'shipped', 'delivered', 'completed']

async function assertNoActiveAfterSale (orderId, transaction) {
  const existing = await AfterSale.findOne({
    where: { order_id: orderId, status: { [Op.in]: ['pending', 'approved'] } },
    transaction,
    lock: transaction.LOCK.UPDATE
  })
  if (existing) {
    const err = new Error('该订单已有进行中的售后申请，请勿重复提交')
    err.status = 400
    throw err
  }
}

async function assertPointsCanBeRevoked (order, transaction) {
  const earnTxs = await PointTransaction.findAll({
    where: { order_id: order.id, type: 'earn_purchase' },
    transaction
  })
  const totalEarned = earnTxs.reduce((sum, tx) => sum + Math.abs(Number(tx.delta) || 0), 0)
  if (totalEarned <= 0) return
  const balanceRow = await UserPointBalance.findOne({
    where: { user_id: order.user_id },
    transaction,
    lock: transaction.LOCK.UPDATE
  })
  const balance = Number(balanceRow?.balance) || 0
  if (balance < totalEarned) {
    const err = new Error(`该订单获得的 ${totalEarned} 积分已被使用（当前余额 ${balance}），请先归还相关积分兑换订单`)
    err.status = 400
    throw err
  }
}


/**
 * 业务错误：带 HTTP 状态码，由控制器的 catch 分支统一转成响应。
 * 用它替代「事务内 rollback + return res.status(...)」——
 * 后者在被 withDeadlockRetry 包裹时会被当成正常返回，导致错误响应丢失。
 */
function httpError (status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

class AfterSaleController {
  static async create (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const userId = req.user?.userId
      const orderId = parseId(req.params.id)
      const { type, reason } = req.body || {}
      if (!orderId) {
        throw httpError(400, '无效的订单 ID')
      }
      if (!userId) {
        throw httpError(401, '请先登录')
      }
      if (!['refund', 'return'].includes(type)) {
        throw httpError(400, '售后类型必须为 refund 或 return')
      }
      if (!reason || String(reason).trim().length < 2 || String(reason).length > 500) {
        throw httpError(400, '请填写 2-500 字的售后原因')
      }

      const order = await Order.findOne({
        where: { id: orderId, user_id: userId },
        transaction,
        lock: transaction.LOCK.UPDATE
      })
      if (!order) {
        throw httpError(404, '订单不存在')
      }
      if (!REQUESTABLE_STATUSES.includes(order.status)) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: `当前订单状态 ${order.status} 不支持申请售后` })
      }

      await assertNoActiveAfterSale(order.id, transaction)
      const row = await AfterSale.create({
        order_id: order.id,
        user_id: userId,
        type,
        reason: String(reason).trim(),
        status: 'pending'
      }, { transaction })
      await transaction.commit()
      return res.status(201).json({ success: true, message: '售后申请已提交', data: row })
    } catch (error) {
      // 事务可能尚未创建（参数校验阶段就抛错）→ 可选链兜底
      if (typeof transaction !== 'undefined') await transaction.rollback().catch(() => {})
      if (error.status) return res.status(error.status).json({ success: false, message: error.message })
      logger.error('创建售后申请失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '提交售后申请失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }

  static async listMine (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) return res.status(401).json({ success: false, message: '请先登录' })
      const rows = await AfterSale.findAll({
        where: { user_id: userId },
        include: [{ model: Order, as: 'order', attributes: ['id', 'order_no', 'status'] }],
        order: [['created_at', 'DESC']]
      })
      return res.json({ success: true, data: rows })
    } catch (error) {
      logger.error('读取售后列表失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '读取售后列表失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }

  static async listAdmin (req, res) {
    try {
      const status = req.query.status
      const where = status ? { status } : {}
      const rows = await AfterSale.findAll({
        where,
        include: [{ model: Order, as: 'order', attributes: ['id', 'order_no', 'status'] }],
        order: [['created_at', 'DESC']],
        limit: 200
      })
      return res.json({ success: true, data: rows })
    } catch (error) {
      logger.error('读取售后管理列表失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '读取售后列表失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }

  static async review (req, res) {
    const id = parseId(req.params.id)
    const { status, admin_note: adminNote = null } = req.body || {}
    // 参数校验放在事务之前：避免事务内提前 return 不 rollback 造成连接泄漏
    if (!id) {
      return res.status(400).json({ success: false, message: '无效的售后单 ID' })
    }
    if (!['approved', 'rejected', 'received'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的审核状态' })
    }

    try {
      /**
       * 套 withDeadlockRetry：售后审批会同时锁售后单、订单、库存与积分余额，
       * 与订单取消/删除路径存在交叉加锁，死锁（40P01/40001）时重试而不是直接 500。
       */
      const result = await withDeadlockRetry(async () => {
      const transaction = await sequelize.transaction()
      try {
      const row = await AfterSale.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE })
      if (!row) {
        throw httpError(404, '售后申请不存在')
      }

      const order = await Order.findByPk(row.order_id, { transaction, lock: transaction.LOCK.UPDATE })
      if (!order) {
        throw httpError(404, '关联订单不存在')
      }

      if (status === 'approved') {
        if (row.status !== 'pending') {
          throw httpError(400, '当前售后申请不允许再次审核')
        }
        /**
         * 订单已被取消过（此前已回补过库存/积分）→ 拒绝再次回补，
         * 否则「取消 + 售后审批」叠加会造成库存虚增、积分被扣两次。
         * restoreOrderResources 内部还有 cancelled 幂等护栏，这里是更早的显式拦截。
         */
        if (order.status === 'cancelled') {
          throw httpError(400, '该订单已取消，无法再通过售后审批回补资源')
        }
        if (row.type === 'refund') {
          await assertPointsCanBeRevoked(order, transaction)
          order.items = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
          await restoreOrderResources(order, transaction)
          order.status = 'cancelled'
          await order.save({ transaction })
        }
      } else if (status === 'received') {
        if (row.status !== 'approved' || row.type !== 'return') {
          throw httpError(400, '只有已同意的退货申请才能确认收货')
        }
        if (order.status === 'cancelled') {
          throw httpError(400, '该订单已取消，无法再确认收货回补资源')
        }
        await assertPointsCanBeRevoked(order, transaction)
        order.items = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
        await restoreOrderResources(order, transaction)
        order.status = 'cancelled'
        await order.save({ transaction })
      } else if (status === 'rejected' && row.status !== 'pending') {
        throw httpError(400, '当前售后申请不允许拒绝')
      }

      row.status = status
      row.admin_note = adminNote != null ? String(adminNote).slice(0, 500) : null
      await row.save({ transaction })
      await transaction.commit()
      return row
      } catch (e) {
        await transaction.rollback().catch(() => {})
        throw e
      }
      })
      return res.json({ success: true, message: '售后状态已更新', data: result })
    } catch (error) {
      // 事务在 withDeadlockRetry 内层已 rollback，这里不能再引用
      if (error.status) return res.status(error.status).json({ success: false, message: error.message })
      logger.error('审核售后申请失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '审核售后申请失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }
}

AfterSale.belongsTo(Order, { foreignKey: 'order_id', as: 'order' })
Order.hasMany(AfterSale, { foreignKey: 'order_id', as: 'afterSales' })

export default AfterSaleController
