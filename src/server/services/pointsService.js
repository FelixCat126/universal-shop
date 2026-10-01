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
  if (row) return row
  /**
   * 并发首笔建行竞态：create 包在 SAVEPOINT 里，撞 user_id 唯一约束（PG 23505）时
   * 只回滚到保存点（PG 报错后整事务进入 aborted 状态，无保存点则后续查询必失败），
   * 再按行锁重新读取抢先建行方已提交的那一行；仍取不到才向上抛。
   */
  const sp = await sequelize.transaction({ transaction })
  try {
    row = await UserPointBalance.create(
      { user_id: userId, balance: 0 },
      { transaction: sp }
    )
    await sp.commit()
    return row
  } catch (e) {
    await sp.rollback().catch(() => {})
    const isUniqueViolation =
      e?.name === 'SequelizeUniqueConstraintError' ||
      e?.parent?.code === '23505' ||
      e?.original?.code === '23505'
    if (!isUniqueViolation) throw e
    row = await UserPointBalance.findOne({
      where: { user_id: userId },
      transaction,
      lock: transaction.LOCK.UPDATE
    })
    if (!row) throw e
    return row
  }
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
 * 真实支付订单成交后发放购物积分
 * 发放口径（P1 起）：按订单折后实付泰铢金额换算 —— floor(实付THB × points_earn_rate)，
 * 由调用方（orderController / pricingEngine.calcPointsEarn）算好后传入；
 * options.transaction 传入时复用调用方事务（不再自建事务，失败随调用方一起回滚）；
 * 不传则自建独立事务（订单事务已提交后的场景），失败仅向上抛、由调用方决定如何处理。
 */
export async function grantPurchasePoints (userId, orderId, points, options = {}) {
  const n = Number(points)
  if (!userId || !Number.isFinite(n) || n <= 0) return
  const run = async (t) => {
    const row = await lockOrCreateBalance(userId, t)
    row.balance = row.balance + n
    await row.save({ transaction: t })
    await PointTransaction.create({
      user_id: userId,
      order_id: orderId,
      type: 'earn_purchase',
      delta: n,
      balance_after: row.balance,
      note: `购物获得 ${n} 积分（按实付金额计）`
    }, { transaction: t })
  }
  if (options.transaction) {
    await run(options.transaction)
  } else {
    await sequelize.transaction(run)
  }
}

/**
 * 订单取消/删除：退回积分换购扣减的积分（与订单操作同一事务）
 */
export async function refundPointsForOrder (transaction, {
  userId,
  orderId,
  points,
  note = null
}) {
  const n = Number(points)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('无效的退回积分')
  }
  const row = await lockOrCreateBalance(userId, transaction)
  row.balance = row.balance + n
  await row.save({ transaction })
  await PointTransaction.create({
    user_id: userId,
    order_id: orderId,
    type: 'refund_cancel',
    delta: n,
    balance_after: row.balance,
    note: note || '订单取消退回积分'
  }, { transaction })
}

/**
 * 订单取消/删除：收回已发放的购物积分（与订单操作同一事务）
 * 余额不足时余额按 0 截断，流水只记实际收回量（截断前的差值）
 * 返回 { requested, revoked, truncated } 供调用方判断是否告警
 */
export async function revokePurchasePoints (transaction, {
  userId,
  orderId,
  points,
  note = null
}) {
  const n = Number(points)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('无效的收回积分')
  }
  const row = await lockOrCreateBalance(userId, transaction)
  const before = Number(row.balance) || 0
  const revoked = Math.min(before, n)
  // 余额已为 0、实际收回 0 时不写 delta=0 的流水（审计噪音），直接返回
  if (revoked === 0) {
    return { requested: n, revoked: 0, truncated: n }
  }
  row.balance = Math.max(0, before - n)
  await row.save({ transaction })
  await PointTransaction.create({
    user_id: userId,
    order_id: orderId,
    type: 'revoke_cancel',
    delta: -revoked,
    balance_after: row.balance,
    note: note || '订单取消收回购物积分'
  }, { transaction })
  return { requested: n, revoked, truncated: n - revoked }
}
