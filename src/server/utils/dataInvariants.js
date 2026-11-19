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
/**
 * 插入一条**违反外键**的行（仅自证用）。
 *
 * ## 为什么需要它
 *
 * 测试库的表结构是 sequelize.sync() 建的，比**生产库更全**：
 * 例如 `carts.bundle_id` 在测试库有外键（SET NULL），在生产库**没有**。
 * 于是"生产库真能出现的悬空行"在测试库里**根本插不进去** ——
 * 自证做不了 → 这项检查要么被误标成"防御项"（把真能报的说成不可能），
 * 要么干脆没人写（更糟）。
 *
 * 办法：临时禁用该表的触发器（需要表属主权限，测试库满足），插入后恢复。
 *
 * ⚠️ 只在测试库使用：生产的 `--self-test` 已被脚本硬闸拦住（会清库）。
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

/**
 * custom 检查项需要访问模型实例（bcrypt 比对要用）。
 * 由 checkDataInvariants 在运行时注入，避免在模块加载时就去连数据库。
 */
let sequelizeRef = { models: {} }
function setInvariantSequelizeRef (instance) {
  sequelizeRef = instance
}

const CHECKS = [
  /**
   * 管理端/合作方账号不得仍在使用**出厂默认口令**。
   *
   * 第 33 轮安全彻查实测发现：生产的 1 个管理员 + 2 个合作方账号的密码
   * 全都是出厂值 123456 —— 站点在公网，等于任何人都能登进后台。
   *
   * 这一项是**防复发**的闸：靠 scripts/force-password-reset.mjs 置位解决当下，
   * 靠这一项保证以后不会再悄悄回到默认口令。
   *
   * 为什么用 custom 而不是 SQL：bcrypt 比对必须是异步的，且 SQL 无法做哈希比对。
   */
  {
    name: 'no_default_password_accounts',
    title: '管理端/合作方账号不得仍在使用默认口令',
    custom: async () => {
      const bcrypt = await import('bcrypt')
      const { Administrator, Partner } = sequelizeRef.models
      const out = []
      /**
       * 判定口径：**仍在用默认口令，且没有被标记为"必须改密"**才算违规。
       *
       * 为什么标记了就不算：
       *   风险不是"密码是 123456"本身，而是"能用 123456 长期使用后台"。
       *   被标记 must_reset_password 的账号，登录后会被服务端拦住（403）
       *   并强制改密 —— 风险已经被**处置**，不该再反复报。
       *   （否则这项会永远红，而"永远红的体检"没人看 —— 等于没有体检。）
       */
      const admins = await Administrator.findAll({ attributes: ['id', 'username', 'password', 'must_reset_password'] })
      for (const a of admins) {
        if (a.must_reset_password === true) continue
        if (await bcrypt.compare('123456', a.password)) {
          out.push({ id: a.id, account: a.username, kind: 'administrator', issue: '仍在使用默认口令 123456，且未强制改密' })
        }
      }
      const partners = await Partner.findAll({ attributes: ['id', 'login', 'password', 'must_reset_password'] })
      for (const p of partners) {
        if (p.must_reset_password === true) continue
        if (await bcrypt.compare('123456', p.password)) {
          out.push({ id: p.id, account: p.login, kind: 'partner', issue: '仍在使用默认口令 123456，且未强制改密' })
        }
      }
      return out
    },
    selfTest: async (m) => {
      /**
       * 造一个用默认口令的管理员。
       *
       * 必须**绕过模型校验与 hook**：模型层已经禁止弱密码
       * （管理员密码策略是后来加的，生产上残留的 123456 是历史数据），
       * 走正常 create 会被 Validation error 挡下来 —— 那就造不出违规数据了。
       * hooks:false 同时避免 beforeCreate 再 hash 一次（会变成"密码是哈希的哈希"）。
       */
      const bcrypt = await import('bcrypt')
      const hash = await bcrypt.hash('123456', 10)
      await m.Administrator.bulkCreate([{
        username: 'selftest_default_pwd_' + Date.now(),
        email: 'selftest_default_pwd_' + Date.now() + '@test.local',
        password: hash,
        role: 'admin',
        is_active: true
      }], { validate: false, hooks: false })
    }
  },

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
    /**
     * 订单实收必须**等于**各行应付之和（既不能多收，也不能少收）。
     *
     * 为什么必须有这一条：原有的 `order_total_not_exceeding_items` 只查
     * 「实收 ≤ 明细原价之和」—— 只能抓"多收了钱"，
     * **抓不到"少收了钱"**（实收 < 行应付之和 = 客户少付/账单对不上）。
     *
     * 口径：
     *   - 行应付 = line_total - discount_allocated
     *     （line_total 是该行权威小计，组合包按权重分摊时 price×quantity ≠ line_total；
     *      discount_allocated 是摊到该行的满减+券）
     *   - line_total 为 NULL 的老行按 price × quantity 兜底（与 011 迁移的回填口径一致）
     *   - 赠品行（is_gift）不参与金额
     *   - **积分兑换单排除**：那种单实收记 0（用积分付的），而行里记的是 THB 参考价，
     *     两者本就不该相等（拿它来判会每单误报）
     */
    name: 'order_total_equals_lines_payable',
    title: '订单实收必须等于各行应付之和（不能多收也不能少收）',
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m)
      // 实收被改成与明细对不上（多收了钱）
      await m.Order.update({ total_amount_thb: 123.45 }, { where: { id: order.id } })
    },
    sql: `
      SELECT o.id AS id, o.order_no AS order_no,
             COALESCE(o.total_amount_thb, o.total_amount) AS total,
             ROUND(COALESCE(SUM(COALESCE(i.line_total, i.price * i.quantity) - i.discount_allocated), 0), 2) AS lines_payable
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      WHERE COALESCE(i.is_gift, false) = false
        AND o.payment_method <> 'points'
      GROUP BY o.id, o.order_no, COALESCE(o.total_amount_thb, o.total_amount)
      HAVING ABS(
        COALESCE(o.total_amount_thb, o.total_amount)
        - ROUND(COALESCE(SUM(COALESCE(i.line_total, i.price * i.quantity) - i.discount_allocated), 0), 2)
      ) > 0.01
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
    /**
     * 已用券挂的订单必须**真实存在**。
     *
     * `user_coupons.used_by_order_id` **没有外键**（该列只做逻辑关联，
     * 因为订单允许硬删），所以这是全库少数几个"孤儿真能出现"的引用之一 ——
     * 与 after_sales.user_id 同类。
     *
     * 为什么必须单独查：原有的 coupon_used_has_order 只查
     * `used_by_order_id IS NULL`（压根没挂），**查不出"挂着一个不存在的订单"** ——
     * 检查名叫 has_order，却没验证 order 是否存在，属于"永远绿的假检查"。
     *
     * 真实触发场景：管理端删除已履约订单时券没被释放（已修），
     * 以及任何绕过应用层直接写库的操作。
     */
    name: 'coupon_used_order_exists',
    title: '已用券挂的订单必须真实存在（不能挂幽灵订单）',
    selfTest: async (m) => {
      const { user } = await makeSelfTestOrder(m)
      // template_id 必须真实存在（user_coupons.template_id 是 NO ACTION 外键）
      const tpl = await m.CouponTemplate.create({
        name: `自证悬空券_${Date.now()}`,
        type: 'discount',
        amount: 50,
        min_spend: 100,
        status: 'active',
        scope: { type: 'all', ids: [] }
      })
      // used_by_order_id 指向一个**不存在**的订单（该列无外键，能插进去）
      await m.UserCoupon.create({
        template_id: tpl.id, user_id: user.id, code: `DANG${Date.now().toString(36)}`,
        status: 'used', used_by_order_id: 2147483647
      })
    },
    sql: `SELECT c.id, c.user_id, c.code, c.used_by_order_id
          FROM user_coupons c
          WHERE c.status = 'used'
            AND c.used_by_order_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = c.used_by_order_id)`
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
    /**
     * ⚠️ 之前这里被标成"防御项（由外键保证，应用层造不出）" —— **那是错的**。
     *
     * 事实：`after_sales.order_id` **根本没有外键**（测试库与生产库都没有）。
     * 应用层删单时确实会显式清理售后单，但那是**应用层的约定**，不是数据库的保证；
     * 任何绕过应用层的写库（脚本、迁移、运维直连）都能造出孤儿售后单。
     *
     * 误标成"防御项"的代价：以为这块有 FK 兜底 → 少了一条真能报的检查，
     * 而且第 9 轮"全库唯一无外键引用是 after_sales.user_id"的结论也是错的 ——
     * `after_sales.order_id` 与 `user_coupons.used_by_order_id` 同样没有外键。
     */
    selfTest: async (m) => {
      const { order } = await makeSelfTestOrder(m)
      // order_id 指向不存在的订单（该列无外键，能插进去）
      await m.AfterSale.create({
        order_id: 99999999, user_id: order.user_id, type: 'refund',
        status: 'pending', reason: '自证', amount: 100
      })
    },
    sql: `SELECT a.id AS id, a.order_id AS order_id FROM after_sales a
          LEFT JOIN orders o ON o.id = a.order_id WHERE o.id IS NULL`
  },
  {
    name: 'after_sale_user_exists',
    // ⚠️ after_sales.user_id **没有外键保护** → 这项是真能报出来的检查
    // （注意：不是"全库唯一"—— after_sales.order_id 与 user_coupons.used_by_order_id
    //   同样没有外键；全库无外键的 *_id 列共 14 个，见 docs/bug-hunt-round7-11.md）
    title: '售后单必须挂在存在的用户上（该列无外键保护，真能报）',
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
    /**
     * 防御项：carts.product_id → products 有外键，**插入时指向不存在的商品会被直接拒绝**
     * （两个库都是这样：测试库 SET NULL、生产库 NO ACTION）。
     *
     * ⚠️ 测试库与生产库的 delete_rule 不同（SET NULL vs NO ACTION）：
     * 删商品时，测试库会把购物车行的 product_id 置 NULL（合法状态，等着被清理），
     * 生产库则直接拒绝删商品。**两个库都不会产生"指向不存在商品"的行**，
     * 所以检查里排除 NULL 是对的 —— 但别把规则记错。
     */
    //   - 插入时受外键约束 → 造不出"指向不存在商品"的行
    //   - 商品被删后该列置 NULL 是**合法**状态（购物车行等着被清理）
    // 所以本项只是防止将来有人去掉外键后悄悄产生孤儿
    defensive: true,
    defensiveReason: 'carts.product_id → products 有外键，插入时指向不存在的商品会被直接拒绝（生产库 NO ACTION / 测试库 SET NULL，两个库都不会产生孤儿行）',
    sql: `SELECT c.id AS id, c.product_id AS product_id FROM carts c
          LEFT JOIN products p ON p.id = c.product_id
          WHERE c.product_id IS NOT NULL AND p.id IS NULL`
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
  setInvariantSequelizeRef({ models: sequelize.models })
  const results = []
  for (const check of CHECKS) {
    let list = []
    let error = null
    try {
      if (check.custom) {
        // 自定义异步检查（如 bcrypt 比对默认口令）：直接给违规行
        list = (await check.custom()) || []
      } else {
        const out = await sequelize.query(check.sql, {
          type: QueryTypes.SELECT,
          replacements: { days: String(recentDays) }
        })
        const rows = Array.isArray(out?.[0]) ? out[0] : (Array.isArray(out) ? out : [])
        list = Array.isArray(rows) ? rows : []
        if (check.filter) {
          // filter 允许是异步函数（bcrypt 比对必须异步）
          list = (await check.filter(list)) || []
        }
      }
    } catch (err) {
      error = err
      list = []
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

export { CHECKS, setInvariantSequelizeRef }
