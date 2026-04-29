import sequelize from '../config/database.js'
import UserPointBalance from '../models/UserPointBalance.js'
import PointTransaction from '../models/PointTransaction.js'

/**
 * 读取当前余额（无记录视为 0）
 */
export async function getBalance (userId) {
  const row = await UserPointBalance.findOne({ where: { user_id: userId } })
  return row ? Number(row.balance) || 0 : 0
}

async function lockOrCreateBalance (userId, transaction) {
  let row = await UserPointBalance.findOne({
    where: { user_id: userId },
    transaction,
    lock: transaction.LOCK.UPDATE
  })
  if (!row) {
    row = await UserPointBalance.create(
      { user_id: userId, balance: 0 },
      { transaction }
    )
  }
  return row
}

/**
 * 下单扣减积分（与订单同一事务）
 */
export async function redeemPointsForOrder (transaction, {
  userId,
  orderId,
  points,
  note = null
}) {
  const n = Number(points)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('无效的扣减积分')
  }
  const row = await lockOrCreateBalance(userId, transaction)
  if (row.balance < n) {
    const insufficient = new Error('POINTS_INSUFFICIENT')
    throw insufficient
  }
  row.balance = row.balance - n
  await row.save({ transaction })
  await PointTransaction.create({
    user_id: userId,
    order_id: orderId,
    type: 'redeem_order',
    delta: -n,
    balance_after: row.balance,
    note: note || '积分换购扣减'
  }, { transaction })
}

/**
 * 真实支付订单成交后：按件发放积分（每笔订单内件数之和）
 * 在订单事务已提交后调用；失败仅打日志。
 */
export async function grantPurchasePoints (userId, orderId, quantityTotal) {
  const n = Number(quantityTotal)
  if (!userId || !Number.isFinite(n) || n <= 0) return
  await sequelize.transaction(async (t) => {
    const row = await lockOrCreateBalance(userId, t)
    row.balance = row.balance + n
    await row.save({ transaction: t })
    await PointTransaction.create({
      user_id: userId,
      order_id: orderId,
      type: 'earn_purchase',
      delta: n,
      balance_after: row.balance,
      note: `购物获得 ${n} 积分（按件计）`
    }, { transaction: t })
  })
}
