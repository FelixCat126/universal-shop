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

/**
 * 自证用的最小数据工厂（**只给 selfTest 用**）。
 *
 * 目的：让每条检查都能**证明自己真的会响** ——
 * 直接写库造出违规数据（绕过应用层的校验），再跑这条检查，
 * 必须能抓到。抓不到 = 这条检查是"永远绿的假检查"。
 */
async function makeSelfTestOrder (m, opts = {}) {
  const user = await m.User.create({
    username: `selftest_u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    nickname: '自证用户',
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    password: 'Abcd1234',
    is_active: true
  })
  const product = await m.Product.create({
    name: `自证商品_${Date.now()}`,
    price: 100,
    stock: 100,
    status: 'active'
  })
  const order = await m.Order.create({
    order_no: `selftest_o_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    user_id: user.id,
    total_amount: 100,
    total_amount_thb: 100,
    currency_code: 'THB',
    payment_method: 'cod',
    status: opts.status || 'shipping',
    contact_name: '自证',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1
  })
  const item = await m.OrderItem.create({
    order_id: order.id,
    product_id: product.id,
    quantity: 1,
    price: 100,
    original_price: 100,
    product_name_zh: product.name
  })
  return { user, product, order, item }
}

const CHECKS = [
  // ── 硬约束 ──────────────────────────────────────────────
  {
    name: 'stock_not_negative',
    title: '商品库存不能为负',
    selfTest: async (m) => {
      const p = await m.Product.create({ name: `自证负库存_${Date.now()}`, price: 1, stock: 1, status: 'active' })
      await m.Product.update({ stock: -1 }, { where: { id: p.id } })
    },
    sql: `SELECT id, name, stock FROM products WHERE stock < 0`
  },
  {
    name: 'order_item_quantity_positive',
    title: '订单明细数量必须为正',
    selfTest: async (m) => {
      const { item } = await makeSelfTestOrder(m)
      await m.OrderItem.update({ quantity: 0 }, { where: { id: item.id } })
    },
    sql: `SELECT id, order_id, quantity FROM order_items WHERE quantity <= 0`
  },
  {
    name: 'order_total_not_exceeding_items',
    title: '订单总额不能超过明细原价之和（不能多收钱）',
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m)
      await m.Order.update({ total_amount_thb: 999999 }, { where: { id: order.id } })
    },
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
    selfTest: async (m) => {
      const { user } = await makeSelfTestOrder(m)
      // 余额 100 但一条流水都没有 → 余额 ≠ 流水累计
      await m.UserPointBalance.create({ user_id: user.id, balance: 100 })
    },
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
    selfTest: async (m) => {
      const { user, order } = await makeSelfTestOrder(m)
      await m.UserPointBalance.create({ user_id: user.id, balance: 100 })
      await m.PointTransaction.create({
        user_id: user.id, order_id: order.id, type: 'earn_purchase',
        delta: 100, balance_after: 100, description: '自证'
      })
      await m.UserPointBalance.update({ balance: 200 }, { where: { user_id: user.id } })
    },
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
    selfTest: async (m) => {
      const { user } = await makeSelfTestOrder(m)
      await m.UserPointBalance.create({ user_id: user.id, balance: -5 })
    },
    sql: `SELECT user_id AS id, balance FROM user_point_balances WHERE balance < 0`
  },
  {
    name: 'coupon_used_has_order',
    title: '已使用的券必须挂上 used_by_order_id',
    selfTest: async (m) => {
      const { user } = await makeSelfTestOrder(m)
      // template_id 必须真实存在（user_coupons.template_id 是 NO ACTION 外键）
      const tpl = await m.CouponTemplate.create({
        name: `自证券模板_${Date.now()}`,
        type: 'discount',
        amount: 50,
        min_spend: 100,
        status: 'active',
        scope: { type: 'all', ids: [] }
      })
      await m.UserCoupon.create({
        template_id: tpl.id, user_id: user.id, code: `SELFTEST${Date.now()}`,
        status: 'used', used_by_order_id: null
      })
    },
    sql: `SELECT id, user_id, code FROM user_coupons WHERE status = 'used' AND used_by_order_id IS NULL`
  },
  {
    name: 'coupon_template_exists',
    title: '用户券的模板必须存在（不能有孤儿券）',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'user_coupons.template_id → coupon_templates 是 NO ACTION 外键',
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
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'users.referral_code 上有唯一索引 users_referral_code_key：重复值根本插不进去',
    sql: `
      SELECT referral_code AS id, COUNT(*) AS cnt FROM users
      WHERE referral_code IS NOT NULL AND referral_code <> ''
      GROUP BY referral_code HAVING COUNT(*) > 1
    `
  },
  {
    name: 'export_job_file_exists',
    title: '已完成导出任务的文件必须还在磁盘上',
    selfTest: async (m) => {
      await m.ExportJob.create({
        admin_id: 1, admin_username: 'selftest',
        type: 'orders', status: 'done',
        file_path: '/tmp/selftest-does-not-exist.xlsx'
      })
    },
    sql: `SELECT id, file_path FROM export_jobs WHERE status = 'done' AND file_path IS NOT NULL`,
    // 文件是否还在磁盘上要靠 fs 判断，SQL 查不出来
    filter: (rows) => rows.filter(r => r.file_path && !fs.existsSync(r.file_path))
  },
  {
    name: 'export_job_owner_exists',
    title: '导出任务的管理员必须存在',
    selfTest: async (m) => {
      await m.ExportJob.create({
        admin_id: 99999999, admin_username: 'selftest',
        type: 'orders', status: 'pending'
      })
    },
    sql: `
      SELECT j.id AS id, j.admin_id
      FROM export_jobs j
      LEFT JOIN administrators a ON a.id = j.admin_id
      WHERE a.id IS NULL
    `
  },

  // ── 引用完整性（孤儿行）─────────────────────────────────
  //
  // 以前这些检查只在我临时写的脚本里跑，**没进每日体检** ——
  // 将来某次写入把关联行删了，要等客户投诉"我的退款结不掉"才会被发现。
  //
  // ⚠️ **哪些是"真检查"、哪些是"外键已保证的防御"**（实测生产库的 FK）：
  //   NO ACTION（删父行会被 DB 拦住 → 孤儿不可能出现）：
  //     order_items.order_id / order_items.product_id / orders.user_id
  //     after_sales.order_id / user_coupons.* / partner_orders.partner_id
  //     order_promotions.order_id / partner_order_items.* / bundle_items.*
  //   SET NULL（删父行后关联列变 NULL —— **这是合法状态**，检查必须排除 NULL）：
  //     carts.product_id / carts.user_id / carts.bundle_id
  //     point_transactions.order_id / products.category_id
  //   CASCADE（删父行时级联删掉子行 → 孤儿不可能）：
  //     point_transactions.user_id / user_point_balances.user_id
  //   **无外键**（唯一真能出现孤儿的）：
  //     after_sales.user_id
  {
    name: 'order_item_order_exists',
    title: '订单明细必须挂在存在的订单上（外键 NO ACTION 保证，本项为防御）',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'order_items.order_id → orders 是 NO ACTION 外键：删父行会被数据库直接拒绝，孤儿行产生不出来',
    sql: `SELECT i.id AS id, i.order_id AS order_id FROM order_items i
          LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL`
  },
  {
    name: 'order_item_product_exists',
    title: '订单明细必须挂在存在的商品上',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'order_items.product_id → products 是 NO ACTION 外键：删商品会被数据库拒绝',
    sql: `SELECT i.id AS id, i.product_id AS product_id FROM order_items i
          LEFT JOIN products p ON p.id = i.product_id WHERE p.id IS NULL`
  },
  {
    name: 'after_sale_order_exists',
    title: '售后单必须挂在存在的订单上',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'after_sales.order_id → orders 是 NO ACTION 外键（这正是删订单会 500 的原因）',
    sql: `SELECT a.id AS id, a.order_id AS order_id FROM after_sales a
          LEFT JOIN orders o ON o.id = a.order_id WHERE o.id IS NULL`
  },
  {
    name: 'after_sale_user_exists',
    // ⚠️ after_sales.user_id 是全库**唯一没有外键保护**的用户引用 →
    // 这项是真能报出来的检查（其余引用项都是防御）
    title: '售后单必须挂在存在的用户上（无外键保护，唯一真能报的一项）',
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m)
      // after_sales.user_id 是全库唯一没有外键保护的用户引用 → 能造出孤儿
      await m.AfterSale.create({
        order_id: order.id, user_id: 99999999, type: 'refund',
        status: 'pending', reason: '自证', amount: 100
      })
    },
    sql: `SELECT a.id AS id, a.user_id AS user_id FROM after_sales a
          LEFT JOIN users u ON u.id = a.user_id WHERE a.user_id IS NOT NULL AND u.id IS NULL`
  },
  {
    name: 'cart_product_exists',
    // carts.product_id 是 SET NULL —— 商品被删后置 NULL 是**合法**的（该行等着被清理），
    // 所以只检查"非 NULL 却指向不存在的商品"
    title: '购物车行必须挂在存在的商品上（NULL = 商品已删，待清理）',
    // 防御项：carts.product_id → products 是 SET NULL 外键
    //   - 插入时受外键约束 → 造不出"指向不存在商品"的行
    //   - 商品被删后该列置 NULL 是**合法**状态（购物车行等着被清理）
    // 所以本项只是防止将来有人去掉外键后悄悄产生孤儿
    defensive: true,
    defensiveReason: 'carts.product_id → products 是 SET NULL 外键；NULL 是合法状态（待清理），插入时也受约束 → 应用层造不出孤儿行',
    sql: `SELECT c.id AS id, c.product_id AS product_id FROM carts c
          LEFT JOIN products p ON p.id = c.product_id
          WHERE c.product_id IS NOT NULL AND p.id IS NULL`
  },
  {
    name: 'user_coupon_template_exists',
    title: '用户券必须挂在存在的券模板上',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'user_coupons.template_id → coupon_templates 是 NO ACTION 外键',
    sql: `SELECT uc.id AS id, uc.template_id AS template_id FROM user_coupons uc
          LEFT JOIN coupon_templates ct ON ct.id = uc.template_id WHERE ct.id IS NULL`
  },
  {
    name: 'point_transaction_user_exists',
    title: '积分流水必须挂在存在的用户上',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'point_transactions.user_id → users 是 CASCADE 外键：删用户时流水一并删除',
    sql: `SELECT pt.id AS id, pt.user_id AS user_id FROM point_transactions pt
          LEFT JOIN users u ON u.id = pt.user_id WHERE u.id IS NULL`
  },
  {
    name: 'order_user_exists',
    title: '订单必须挂在存在的用户上',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'orders.user_id → users 是 NO ACTION 外键',
    sql: `SELECT o.id AS id, o.user_id AS user_id FROM orders o
          LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL`
  },
  {
    name: 'partner_order_partner_exists',
    title: '合作方订单必须挂在存在的合作方上',
    // 防御项：由数据库约束保证，应用层造不出这种数据
    defensive: true,
    defensiveReason: 'partner_orders.partner_id → partners 是 NO ACTION 外键',
    sql: `SELECT po.id AS id, po.partner_id AS partner_id FROM partner_orders po
          LEFT JOIN partners p ON p.id = po.partner_id WHERE p.id IS NULL`
  },

  // ── 近期严格（新口径只对近期数据成立）──────────────────
  {
    name: 'recent_order_total_matches_items',
    title: '近期订单：总额 = 明细原价之和 − 分摊优惠（不含赠品行）',
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m)
      await m.Order.update({ total_amount_thb: 999999 }, { where: { id: order.id } })
    },
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
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m, { status: 'paid' })
      // 这项只查**在线支付**订单（COD 单本来就没有 online_paid_at）
      await m.Order.update(
        { payment_method: 'online', online_paid_at: null },
        { where: { id: order.id } }
      )
    },
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
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m)
      await m.Order.update({ points_redeemed: 5 }, { where: { id: order.id } })
    },
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
