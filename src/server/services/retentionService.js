import { withDeadlockRetry } from '../utils/dbRetry.js'
import { Op, fn, col, literal } from 'sequelize'
import sequelize from '../config/database.js'
import AuditLog from '../models/AuditLog.js'
import OperationLog from '../models/OperationLog.js'
import PointTransaction from '../models/PointTransaction.js'
import UserPointBalance from '../models/UserPointBalance.js'
import UserCoupon from '../models/UserCoupon.js'
import Cart from '../models/Cart.js'
import { cleanupExportJobs, cleanupExpiredExportFiles } from './exportJobService.js'
import { checkDataInvariants } from '../utils/dataInvariants.js'
import { logger } from '../utils/logger.js'

/**
 * 数据保留策略：清理只增不减的历史表，防止随业务量无限膨胀。
 *
 * 覆盖的表（都是「只写不删」或「几乎不删」的）：
 *   audit_logs         365 天 —— 审计留痕
 *   operation_logs     730 天 —— 后台操作日志
 *   point_transactions 730 天 —— 积分流水（余额权威在 user_point_balances，
 *                                    流水只作历史凭证，过老的对账价值有限）
 *   user_coupons       365 天 —— 已使用/已过期的券（未使用的券是用户资产，
 *                                    不能删）
 *   carts（游客）        30 天 —— session_id 维度的游客购物车，
 *                                    用户自己的购物车要保留
 *
 * 删除采用「循环批次直到删完」：早期实现每天只删 limit 条，
 * 积压 10 万条需要 100 天才能删完，等于没有清理。
 */

/** 单表删除：循环直到本轮无更多可删（受 maxBatches 上限保护，避免长事务） */
async function purgeInBatches (Model, where, batchSize, maxBatches = 200) {
  let total = 0
  for (let i = 0; i < maxBatches; i++) {
    const deleted = await Model.destroy({ where, limit: batchSize })
    total += deleted
    if (deleted < batchSize) break
  }
  return total
}

/**
 * 清理积分流水，并把**被删流水的净额**记到余额行的 archived_delta。
 *
 * 为什么必须记：
 *   余额是用户资产（不能动），流水是为了控制表体积才清。
 *   清完不记账 → 不变量「余额 = 流水累计」**永久不成立** → 每日体检一直报红，
 *   真实问题被淹没；而且该用户的老订单取消时 earn_purchase 流水已没了 →
 *   earned=0 → 已发的积分收不回来（白拿）。
 *
 * 记了之后：余额 = 剩余流水累计 + archived_delta，**永远精确成立**，
 * 而用户的积分一分没少。
 */
async function purgePointTransactionsWithArchive ({ where, batchSize }) {
  let total = 0
  for (let i = 0; i < 200; i++) {
    /**
     * 一批的「锁 → 汇总 → 记账 → 删除」必须在**同一个事务**里。
     *
     * 为什么以前有隐患：原来是"先算净额、再记账、再删"三条独立语句
     * （各自一个事务）。READ COMMITTED 下每条语句取自己的快照 ——
     * 汇总之后、删除之前若有并发写入积分，那条新流水会被删掉，
     * 但归档净额里**没有它** → 「余额 = 剩余流水累计 + archived_delta」不成立
     * → 每日体检永久报红（用户看着"账不平"，其实是清理脚本的锅）。
     *
     * 修法：先**锁住受影响用户的余额行**（FOR UPDATE，与 pointsService
     * 的 lockOrCreateBalance 同一把锁）→ 并发写积分会等待 →
     * 汇总看到的集合 = 实际删掉的集合 → 归档净额精确。
     *
     * 锁顺序按 user_id 升序（全站约定），避免与其它持锁路径成环。
     */
    /**
     * 套 withDeadlockRetry（第 44 轮）：这里锁**积分余额行**，
     * 与所有积分写路径（下单发积分、取消收积分）用的是同一把锁。
     * 原来没有重试，一旦撞上死锁（40P01），
     * 每日清理任务会直接失败 —— 而"清理失败"往往没人立刻发现，
     * 等发现时流水已经堆了很久。
     */
    const deleted = await withDeadlockRetry(async () => {
      return sequelize.transaction(async (transaction) => {
      // 1) 这批要删的流水涉及哪些用户（升序 → 加锁顺序一致）
      const userRows = await PointTransaction.findAll({
        where,
        attributes: ['user_id'],
        group: ['user_id'],
        order: [['user_id', 'ASC']],
        transaction,
        raw: true
      })
      if (!userRows.length) return 0

      // 2) 锁住这些用户的余额行 → 并发写积分排队等待
      await UserPointBalance.findAll({
        where: { user_id: { [Op.in]: userRows.map((r) => r.user_id) } },
        order: [['user_id', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE
      })

      // 3) 汇总即将被删的流水净额（此时并发写积分已被行锁挡住）
      const sums = await PointTransaction.findAll({
        where,
        attributes: ['user_id', [fn('SUM', col('delta')), 'net']],
        group: ['user_id'],
        transaction,
        raw: true
      })

      // 4) 记进余额行（不存在余额行的用户跳过 —— 余额为 0，归档净额无意义）
      for (const row of sums) {
        const net = Number(row.net) || 0
        if (net === 0) continue
        await UserPointBalance.update(
          { archived_delta: literal(`COALESCE(archived_delta, 0) + ${net}`) },
          { where: { user_id: row.user_id }, transaction }
        )
      }

        // 5) 删除
        return PointTransaction.destroy({ where, limit: batchSize, transaction })
      })
    }, { label: 'retention.purgePointTransactions' })

    total += deleted
    if (deleted < batchSize) break
  }
  return total
}

export async function cleanupRetentionData ({
  auditDays = 365,
  operationDays = 730,
  pointDays = 730,
  couponDays = 365,
  expiredCouponDays = 30,
  guestCartDays = 30,
  batchSize = 1000
} = {}) {
  const now = Date.now()
  const day = 86400000
  const auditCutoff = new Date(now - auditDays * day)
  const operationCutoff = new Date(now - operationDays * day)
  const pointCutoff = new Date(now - pointDays * day)
  const couponCutoff = new Date(now - couponDays * day)
  const guestCartCutoff = new Date(now - guestCartDays * day)

  const auditDeleted = await purgeInBatches(AuditLog, { created_at: { [Op.lt]: auditCutoff } }, batchSize)
  const operationDeleted = await purgeInBatches(OperationLog, { created_at: { [Op.lt]: operationCutoff } }, batchSize)
  const pointDeleted = await purgePointTransactionsWithArchive({
    where: { created_at: { [Op.lt]: pointCutoff } },
    batchSize
  })

  /**
   * 券：只清理「已不可用」的券，未使用的券属于用户资产，绝不能删。
   *   - status='used'    ：按消费时间（updated_at）保留一年，之后清理
   *   - status='expired' ：按有效期（expire_at）判断 —— 券已过期即不可用，
   *                        不该因为用户最近才打开过就一直留着；
   *                        过期超过 30 天才清理，给用户一个「看到历史券」的窗口
   *   - status='void'    ：管理端作废的券（误发/纠纷）同样不可用，
   *                        按作废时间（updated_at）保留一年，之后清理
   */
  const expiredCouponCutoff = new Date(now - expiredCouponDays * day)
  const couponDeleted = await purgeInBatches(UserCoupon, {
    [Op.or]: [
      { status: 'used', updated_at: { [Op.lt]: couponCutoff } },
      { status: 'expired', expire_at: { [Op.lt]: expiredCouponCutoff } },
      { status: 'void', updated_at: { [Op.lt]: couponCutoff } }
    ]
  }, batchSize)

  // 游客购物车：session_id 维度且无 user_id 的，保留 30 天
  const guestCartDeleted = await purgeInBatches(Cart, {
    session_id: { [Op.ne]: null },
    user_id: null,
    updated_at: { [Op.lt]: guestCartCutoff }
  }, batchSize)

  // 导出任务：已完成/失败的任务保留 7 天。
  // 走 exportJobService 的清理（会连磁盘文件一起删），
  // 不用 purgeInBatches —— 后者只删库里的行，会在磁盘留下孤儿 xlsx。
  const exportJobDeleted = (await cleanupExportJobs({ keepDays: 7 })).removed

  return {
    auditDeleted,
    operationDeleted,
    pointDeleted,
    couponDeleted,
    guestCartDeleted,
    exportJobDeleted
  }
}

/**
 * 每日数据体检（只读）。
 *
 * 清理任务只管"该删的删掉"，管不了"数据已经被写坏"。
 * 积分余额与流水对不上、订单总额超过明细、库存成了负数 ——
 * 这些单测发现不了（单测跑的是代码路径，不是生产数据），
 * 只有拿生产数据本身跑一遍不变量检查才知道。
 *
 * 结果只记日志、**不抛错不影响服务**：体检是给人看的，不是用来中断业务的。
 */
export async function runDailyInvariantCheck () {
  try {
    const results = await checkDataInvariants({ sequelize })
    const bad = results.filter(r => r.violations !== 0)
    if (bad.length === 0) {
      logger.info('每日数据体检通过', { checks: results.length })
      return { ok: true, violations: 0 }
    }
    for (const r of bad) {
      logger.error('数据不变量检查未通过', {
        check: r.name,
        title: r.title,
        scope: r.scope,
        violations: r.violations,
        error: r.error || undefined,
        sample: r.detail?.[0] || undefined
      })
    }
    logger.error('每日数据体检发现问题', { failedChecks: bad.length, totalChecks: results.length })
    return { ok: false, violations: bad.reduce((n, r) => n + Math.max(r.violations, 0), 0) }
  } catch (err) {
    logger.error('每日数据体检执行失败', { err: err?.message, stack: err?.stack })
    return { ok: false, violations: -1 }
  }
}

export function startRetentionCleanup () {
  if (process.env.NODE_ENV === 'test') return null
  const timer = setInterval(() => {
    cleanupRetentionData().catch((err) => {
      logger.error('数据保留清理失败', { err: err?.message, stack: err?.stack })
    })
    // 清理完顺手做一次数据体检（只读，不阻断）
    runDailyInvariantCheck().catch(() => {})
    // 导出文件按 TTL 单独清理（与「任务保留 7 天」是两个独立维度：
    // 文件可以先过期消失，任务记录留着让管理员看到「文件已过期」）
    cleanupExpiredExportFiles().catch((err) => {
      logger.error('导出文件清理失败', { err: err?.message })
    })
  }, 24 * 60 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}
