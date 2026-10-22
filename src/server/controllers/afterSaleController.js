import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import AfterSale from '../models/AfterSale.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import PointTransaction from '../models/PointTransaction.js'
import UserPointBalance from '../models/UserPointBalance.js'
import { restoreOrderResources } from './orderController.js'
import { logger } from '../utils/logger.js'

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

class AfterSaleController {
  static async create (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const userId = req.user?.userId
      const orderId = Number(req.params.id)
      const { type, reason } = req.body || {}
      if (!userId) {
        await transaction.rollback()
        return res.status(401).json({ success: false, message: '请先登录' })
      }
      if (!['refund', 'return'].includes(type)) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '售后类型必须为 refund 或 return' })
      }
      if (!reason || String(reason).trim().length < 2 || String(reason).length > 500) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '请填写 2-500 字的售后原因' })
      }

      const order = await Order.findOne({
        where: { id: orderId, user_id: userId },
        transaction,
        lock: transaction.LOCK.UPDATE
      })
      if (!order) {
        await transaction.rollback()
        return res.status(404).json({ success: false, message: '订单不存在' })
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
      await transaction.rollback().catch(() => {})
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
    const transaction = await sequelize.transaction()
    try {
      const id = Number(req.params.id)
      const { status, admin_note: adminNote = null } = req.body || {}
      if (!['approved', 'rejected', 'received'].includes(status)) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '无效的审核状态' })
      }

      const row = await AfterSale.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE })
      if (!row) {
        await transaction.rollback()
        return res.status(404).json({ success: false, message: '售后申请不存在' })
      }

      const order = await Order.findByPk(row.order_id, { transaction, lock: transaction.LOCK.UPDATE })
      if (!order) {
        await transaction.rollback()
        return res.status(404).json({ success: false, message: '关联订单不存在' })
      }

      if (status === 'approved') {
        if (row.status !== 'pending') {
          await transaction.rollback()
          return res.status(400).json({ success: false, message: '当前售后申请不允许再次审核' })
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
          await transaction.rollback()
          return res.status(400).json({ success: false, message: '只有已同意的退货申请才能确认收货' })
        }
        await assertPointsCanBeRevoked(order, transaction)
        order.items = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
        await restoreOrderResources(order, transaction)
        order.status = 'cancelled'
        await order.save({ transaction })
      } else if (status === 'rejected' && row.status !== 'pending') {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '当前售后申请不允许拒绝' })
      }

      row.status = status
      row.admin_note = adminNote != null ? String(adminNote).slice(0, 500) : null
      await row.save({ transaction })
      await transaction.commit()
      return res.json({ success: true, message: '售后状态已更新', data: row })
    } catch (error) {
      await transaction.rollback().catch(() => {})
      if (error.status) return res.status(error.status).json({ success: false, message: error.message })
      logger.error('审核售后申请失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '审核售后申请失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }
}

AfterSale.belongsTo(Order, { foreignKey: 'order_id', as: 'order' })
Order.hasMany(AfterSale, { foreignKey: 'order_id', as: 'afterSales' })

export default AfterSaleController
