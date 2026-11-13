/**
 * 生产数据不变量校验（只读）
 *
 * 单测防的是「代码写错」，这个防的是「**数据被写坏**」——
 * 批处理脚本、并发扣减、人工改库、迁移遗漏，任何一个出岔子，
 * 都会留下「账实不符」的行，而系统本身不会报错（它只是照着坏数据继续算）。
 *
 * 全部检查都是**只读**的（只有 SELECT），可以在生产库上安全运行。
 *
 * ── 两种检查 ───────────────────────────────────────────────
 * 「硬约束」：任何时候都必须成立（如库存不为负、余额=流水累计）。
 *   存量数据若已违反，说明是真的坏了 —— 要报。
 *
 * 「近期严格」：只有**近期**的记录才检查（如"订单总额=明细之和"）。
 *   原因：口径会随版本演进 —— 早期订单的行存原价、总额存折后价，
 *   新订单的行存折后价。拿新口径去查老数据必然一片红，
 *   那样报告就没人看了（旧数据里那一条异常可以单独人工核对）。
 *
 * 窗口默认 30 天（RECENT_DAYS），可用 --recent-days= 调整。
 */
import fs from 'node:fs'
import { QueryTypes } from 'sequelize'

/** 近期窗口的天数 */
export const RECENT_DAYS = 30

/**
 * 每条检查 = { name, title, sql, recent?, filter? }
 * sql 必须返回「违规行」的明细（通常带一个 id 便于定位）。
 */
const CHECKS = [
  // ── 硬约束 ──────────────────────────────────────────────
  {
    name: 'stock_not_negative',
    title: '商品库存不能为负',
    sql: `SELECT id, name, stock FROM products WHERE stock < 0`
  },
  {
    name: 'order_item_quantity_positive',
    title: '订单明细数量必须为正',
    sql: `SELECT id, order_id, quantity FROM order_items WHERE quantity <= 0`
  },
  {
    name: 'order_total_not_exceeding_items',
    title: '订单总额不能超过明细原价之和（不能多收钱）',
    /**
     * ⚠️ 必须用 `total_amount_thb`（泰铢）而不是 `total_amount`。
     *
     * `total_amount` 存的是**结算币种**金额（用户用人民币结算就是 CNY），
     * 而 `order_items.price` 存的是**泰铢**单价 —— 两个量纲直接相减，
     * 非泰铢订单会被误判成"多收了钱"。
     *
     * 生产实测：有一笔 CNY 订单 total_amount=1933.47（CNY），
     * 明细之和 2762.10（THB），直接相减差 828 → 误报。
     */
    sql: `
      SELECT o.id AS id, COALESCE(o.total_amount_thb, o.total_amount) AS total,
             COALESCE(SUM(i.price * i.quantity), 0) AS items_total
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      WHERE COALESCE(i.is_gift, false) = false
      GROUP BY o.id, COALESCE(o.total_amount_thb, o.total_amount)
      HAVING COALESCE(o.total_amount_thb, o.total_amount) > COALESCE(SUM(i.price * i.quantity), 0) + 0.01
    `
  },
  {
    name: 'points_balance_matches_ledger',
    title: '积分余额 = 流水累计（账实相符）',
    sql: `
      SELECT b.user_id AS id, b.balance AS balance,
             COALESCE(t.total, 0) AS ledger_total
      FROM user_point_balances b
      LEFT JOIN (
        SELECT user_id, SUM(delta) AS total FROM point_transactions GROUP BY user_id
      ) t ON t.user_id = b.user_id
      -- archived_delta：被 retention 清理掉的流水净额（余额是用户资产，不能动）
      -- 所以「余额 = 剩余流水累计 + 已归档净额」才是恒等式
      WHERE b.balance <> COALESCE(t.total, 0) + COALESCE(b.archived_delta, 0)
    `
  },
  {
    name: 'points_balance_after_matches_balance',
    title: '最后一笔积分流水的 balance_after = 当前余额',
    sql: `
      SELECT b.user_id AS id, b.balance AS balance, t.balance_after
      FROM user_point_balances b
      JOIN (
        SELECT DISTINCT ON (user_id) user_id, balance_after
        FROM point_transactions ORDER BY user_id, id DESC
      ) t ON t.user_id = b.user_id
      WHERE t.balance_after IS DISTINCT FROM b.balance
    `
  },
  {
    name: 'points_balance_not_negative',
    title: '积分余额不能为负',
    sql: `SELECT user_id AS id, balance FROM user_point_balances WHERE balance < 0`
  },
  {
    name: 'coupon_used_has_order',
    title: '已使用的券必须挂上 used_by_order_id',
    sql: `SELECT id, user_id, code FROM user_coupons WHERE status = 'used' AND used_by_order_id IS NULL`
  },
  {
    name: 'coupon_template_exists',
    title: '用户券的模板必须存在（不能有孤儿券）',
    sql: `
      SELECT uc.id AS id, uc.template_id
      FROM user_coupons uc
      LEFT JOIN coupon_templates ct ON ct.id = uc.template_id
      WHERE ct.id IS NULL
    `
  },
  {
    name: 'referral_code_unique',
    title: '推荐码必须唯一',
    sql: `
      SELECT referral_code AS id, COUNT(*) AS cnt FROM users
      WHERE referral_code IS NOT NULL AND referral_code <> ''
      GROUP BY referral_code HAVING COUNT(*) > 1
    `
  },
  {
    name: 'export_job_file_exists',
    title: '已完成导出任务的文件必须还在磁盘上',
    sql: `SELECT id, file_path FROM export_jobs WHERE status = 'done' AND file_path IS NOT NULL`,
    // 文件是否还在磁盘上要靠 fs 判断，SQL 查不出来
    filter: (rows) => rows.filter(r => r.file_path && !fs.existsSync(r.file_path))
  },
  {
    name: 'export_job_owner_exists',
    title: '导出任务的管理员必须存在',
    sql: `
      SELECT j.id AS id, j.admin_id
      FROM export_jobs j
      LEFT JOIN administrators a ON a.id = j.admin_id
      WHERE a.id IS NULL
    `
  },

  // ── 近期严格（新口径只对近期数据成立）──────────────────
  {
    name: 'recent_order_total_matches_items',
    title: '近期订单：总额 = 明细原价之和 − 分摊优惠（不含赠品行）',
    recent: true,
    /**
     * ⚠️ 两个口径必须对齐：
     *   1. 用 `total_amount_thb`（泰铢）而不是 `total_amount`（**结算币种**）
     *      —— 非泰铢结算的订单会被误判（生产实测有 CNY 单，差 828）
     *   2. 明细侧要**减去 `discount_allocated`**（满减与抵扣券分摊到各行的优惠）
     *      —— 用了满减的订单，应付 < 明细原价和，直接比必然对不上
     *
     * 正确式（生产 9 单实测全部成立，0 例外）：
     *   total_amount_thb = SUM(price * quantity) - SUM(discount_allocated)
     */
    sql: `
      SELECT o.id AS id, COALESCE(o.total_amount_thb, o.total_amount) AS total,
             COALESCE(SUM(i.price * i.quantity), 0) AS items_total
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      WHERE COALESCE(i.is_gift, false) = false
        AND o.created_at >= NOW() - (:days || ' days')::interval
      GROUP BY o.id, COALESCE(o.total_amount_thb, o.total_amount)
      HAVING ABS(
        COALESCE(o.total_amount_thb, o.total_amount)
        - (COALESCE(SUM(COALESCE(i.line_total, i.price * i.quantity)), 0)
           - COALESCE(SUM(COALESCE(i.discount_allocated, 0)), 0))
      ) > 0.01
    `
  },
  {
    name: 'recent_paid_order_has_paid_at',
    title: '近期在线支付订单：必须有 online_paid_at',
    recent: true,
    sql: `
      SELECT id, order_no, status FROM orders
      WHERE payment_method = 'online'
        AND status IN ('paid', 'shipping', 'completed')
        AND online_paid_at IS NULL
        AND created_at >= NOW() - (:days || ' days')::interval
    `
  },
  {
    name: 'recent_order_points_redeemed_has_ledger',
    title: '近期订单的 points_redeemed 必须有对应的积分流水',
    recent: true,
    sql: `
      SELECT o.id AS id, o.points_redeemed
      FROM orders o
      WHERE COALESCE(o.points_redeemed, 0) > 0
        AND o.created_at >= NOW() - (:days || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM point_transactions pt
          WHERE pt.order_id = o.id AND pt.type = 'redeem_order'
        )
    `
  }
]

/**
 * 跑一遍全部不变量检查。
 *
 * @param {object} opts
 * @param {import('sequelize').Sequelize} opts.sequelize 连接实例（只读使用）
 * @param {number} [opts.limit] 每条检查最多取多少行明细（防止生产上拉出十万行）
 * @param {number} [opts.recentDays] 近期窗口天数
 * @returns {Promise<Array<{name, title, scope, violations, detail}>>}
 */
export async function checkDataInvariants ({ sequelize, limit = 20, recentDays = RECENT_DAYS } = {}) {
  if (!sequelize) throw new Error('checkDataInvariants 需要 sequelize 实例')
  const results = []
  for (const check of CHECKS) {
    let rows = []
    let error = null
    try {
      const out = await sequelize.query(check.sql, {
        type: QueryTypes.SELECT,
        replacements: { days: String(recentDays) }
      })
      rows = Array.isArray(out?.[0]) ? out[0] : (Array.isArray(out) ? out : [])
    } catch (err) {
      error = err
    }
    let list = Array.isArray(rows) ? rows : []
    if (!error && check.filter) {
      try {
        list = check.filter(list)
      } catch (err) {
        error = err
      }
    }
    results.push({
      name: check.name,
      title: check.title,
      scope: check.recent ? `近 ${recentDays} 天` : '全部',
      // 查询出错也算不通过 —— 「查不了」不等于「没问题」
      violations: error ? -1 : list.length,
      error: error ? String(error.message || error) : null,
      detail: list.slice(0, limit)
    })
  }
  return results
}

/** 导出全部检查项的名称与范围（给 CLI 单独查某一条用） */
export function listInvariantNames () {
  return CHECKS.map(c => ({
    name: c.name,
    title: c.title,
    scope: c.recent ? `近 ${RECENT_DAYS} 天` : '全部'
  }))
}

export { CHECKS }
