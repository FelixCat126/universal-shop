/**
 * 生产数据不变量校验（只读）
 *
 * 单测防的是「代码写错」，这个防的是「**数据被写坏**」——
 * 批处理脚本、并发扣减、人工改库、迁移遗漏，任何一个出岔子，
 * 都会留下「账实不符」的行，而系统本身不会报错（它只是照着坏数据继续算）。
 *
 * 全部检查都是**只读**的（只有 SELECT），可以在生产库上安全运行。
 *
 * 每条检查返回：
 *   { name, title, violations, detail }
 *   violations = 违反条数（0 = 正常）
 */
import fs from 'node:fs'
import { QueryTypes } from 'sequelize'

/**
 * 每条检查 = { name, title, sql, params }
 * sql 必须返回「违规行」的明细（通常带一个 id 便于定位）。
 */
const CHECKS = [
  {
    name: 'stock_not_negative',
    title: '商品库存不能为负',
    sql: `SELECT id, name, stock FROM products WHERE stock < 0`
  },
  {
    name: 'order_total_matches_items',
    title: '订单金额 = 明细金额之和（允许 0.01 分位误差）',
    sql: `
      SELECT o.id AS id, o.total_amount AS total,
             COALESCE(SUM(i.price * i.quantity), 0) AS items_total
      FROM orders o
      LEFT JOIN order_items i ON i.order_id = o.id
      GROUP BY o.id, o.total_amount
      HAVING ABS(o.total_amount - COALESCE(SUM(i.price * i.quantity), 0)) > 0.01
    `
  },
  {
    name: 'order_item_quantity_positive',
    title: '订单明细数量必须为正',
    sql: `SELECT id, order_id, quantity FROM order_items WHERE quantity <= 0`
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
      WHERE b.balance <> COALESCE(t.total, 0)
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
    name: 'paid_order_has_paid_at',
    title: '已支付订单必须有 online_paid_at',
    sql: `
      SELECT id, order_no, status FROM orders
      WHERE status IN ('paid', 'shipping', 'completed') AND online_paid_at IS NULL
    `
  },
  {
    name: 'order_points_redeemed_has_ledger',
    title: '订单的 points_redeemed 必须有对应的积分流水',
    sql: `
      SELECT o.id AS id, o.points_redeemed
      FROM orders o
      WHERE COALESCE(o.points_redeemed, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM point_transactions pt
          WHERE pt.order_id = o.id AND pt.type = 'redeem_order'
        )
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
    name: 'referred_by_points_to_real_user',
    title: '被推荐码必须指向真实存在的用户',
    sql: `
      SELECT u.id AS id, u.referred_by_code
      FROM users u
      WHERE u.referred_by_code IS NOT NULL AND u.referred_by_code <> ''
        AND NOT EXISTS (
          SELECT 1 FROM users r WHERE r.referral_code = u.referred_by_code
        )
    `
  },
  {
    name: 'export_job_file_exists',
    title: '已完成导出任务的文件必须还在磁盘上',
    sql: `SELECT id, file_path FROM export_jobs WHERE status = 'done' AND file_path IS NOT NULL`,
    // 文件是否还在磁盘上要靠 fs 判断，SQL 查不出来
    filter: (rows) => rows.filter(r => r.file_path && !fs.existsSync(r.file_path))
  }
]

/**
 * 跑一遍全部不变量检查。
 *
 * @param {object} opts
 * @param {import('sequelize').Sequelize} opts.sequelize 连接实例（只读使用）
 * @param {number} [opts.limit] 每条检查最多取多少行明细（防止生产上拉出十万行）
 * @returns {Promise<Array<{name, title, violations, detail}>>}
 */
export async function checkDataInvariants ({ sequelize, limit = 20 } = {}) {
  if (!sequelize) throw new Error('checkDataInvariants 需要 sequelize 实例')
  const results = []
  for (const check of CHECKS) {
    let rows = []
    let error = null
    try {
      rows = await sequelize.query(check.sql, { type: QueryTypes.SELECT })
      if (!Array.isArray(rows)) rows = rows?.[0] || []
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
      // 查询出错也算不通过 —— 「查不了」不等于「没问题」
      violations: error ? -1 : list.length,
      error: error ? String(error.message || error) : null,
      detail: list.slice(0, limit)
    })
  }
  return results
}

/** 导出全部检查项的名称（给 CLI 单独查某一条用） */
export function listInvariantNames () {
  return CHECKS.map(c => ({ name: c.name, title: c.title }))
}

export { CHECKS }
