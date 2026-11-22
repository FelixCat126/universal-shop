/**
 * 017_payment_reconciliation_records —— 支付对账台账
 *
 * ## 背景：超时删掉的单，运营事后对不了账
 *
 * 客户/合作方扫码付款后如果没点「完成付款」，订单 10 分钟后被超时清扫
 * **物理删除**（订单行没了、库存回补了）。此时钱可能已到商户账上，
 * 但系统里**没有这单** —— 运营事后连"有没有过这单、买了什么"都查不到，
 * 只能翻收款码流水对金额。
 *
 * 第 47 轮已在清扫时留了一条 `audit_logs` 审计（含单号/金额/时间），
 * 但**不含商品明细、地址、备注、下单人标识** —— 对账时能对金额，对不上货。
 *
 * ## 为什么是独立表，而不是往 audit_logs.detail 里塞
 *
 * 1. `audit_logs.detail` 是 `json` 列（**不是 jsonb**）也没有索引 ——
 *    拿它当"待核对队列"查会全表扫
 * 2. 对账状态需要**筛选 + 分页 + 状态流转**，那是结构化查询，
 *    不是"审计事件的附加信息"
 * 3. 审计是**只读流水**，对账是**有状态的待办** —— 两者语义不同
 *
 * ## 一个必须说清的架构约束
 *
 * 本系统**没有支付网关**（收款是运营上传的静态二维码 + 用户手工点「完成付款」），
 * 所以"钱到账"这件事**系统本身无从知晓** —— "自动对账"在当前架构下做不到自动。
 * 这张表承载的是**人工对账工作台**：单据完整留存 + 人工标记结论 + 导出给财务。
 * 将来若接入支付网关，webhook 可直接写这张表并把状态置为 received，结构天然兼容。
 *
 * ## 存量回填
 *
 * 把**已经发生过的**超时清扫审计回填成待核对行 ——
 * 历史单据虽然拿不到商品明细（当时就没存），但**单号/金额/时间齐全**，
 * 至少能被对到，不至于"钱收了系统里连单号都没有"。
 *
 * 幂等：按 `order_no` 去重（NOT EXISTS + ON CONFLICT DO NOTHING 双保险）。
 *
 * ## 幂等性
 *
 * 建表/建索引用 IF NOT EXISTS；回填用 NOT EXISTS 去重。
 * 重复执行不产生副作用，也不会写重复行。
 */
export default {
  name: '017_payment_reconciliation_records',
  async up (queryInterface, sequelize) {
    // ---------- 建表 ----------
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS payment_reconciliation_records (
        id                    SERIAL PRIMARY KEY,
        order_type            VARCHAR(16)  NOT NULL,
        order_id              INTEGER,
        order_no              VARCHAR(64)  NOT NULL,
        amount                DECIMAL(12,2),
        currency_code         VARCHAR(8)   DEFAULT 'THB',
        total_amount_thb      DECIMAL(12,2),
        items_snapshot        JSONB,
        contact_name          VARCHAR(100),
        contact_phone         VARCHAR(32),
        delivery_address      VARCHAR(500),
        notes                 VARCHAR(500),
        user_id               INTEGER,
        user_label            VARCHAR(100),
        partner_id            INTEGER,
        order_created_at      TIMESTAMPTZ,
        swept_at              TIMESTAMPTZ,
        reconcile_status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
        received_amount       DECIMAL(12,2),
        bank_ref              VARCHAR(100),
        note                  VARCHAR(500),
        reconciled_by         INTEGER,
        reconciled_by_label   VARCHAR(100),
        reconciled_at         TIMESTAMPTZ,
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)

    // ---------- 索引 ----------
    // order_no 唯一：单号是时间戳+随机生成的，不会复用 —— 可作业务主键
    await sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_order_no ON payment_reconciliation_records (order_no)'
    ).catch((e) => console.warn(`⚠️  idx_reconciliation_order_no 创建失败：${e.message}`))
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON payment_reconciliation_records (reconcile_status)'
    ).catch((e) => console.warn(`⚠️  idx_reconciliation_status 创建失败：${e.message}`))
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_reconciliation_swept_at ON payment_reconciliation_records (swept_at)'
    ).catch((e) => console.warn(`⚠️  idx_reconciliation_swept_at 创建失败：${e.message}`))
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_reconciliation_order_type ON payment_reconciliation_records (order_type)'
    ).catch((e) => console.warn(`⚠️  idx_reconciliation_order_type 创建失败：${e.message}`))

    // ---------- 存量回填 ----------
    /**
     * 从 audit_logs 的超时清扫事件回填。
     *
     * 数字/日期的转换都做了**防御**（正则过滤 + NULLIF）：
     * `detail` 是 json 列，内容由历史代码写入，不保证每条都长得一样 ——
     * 一条脏数据不该让整个迁移失败（迁移失败 = 不写 schema_migrations = 每次启动重跑）。
     */
    // 用 RETURNING 拿到实际插入行数（没有 RETURNING 时 results 是空数组，数不出来）
    const [res] = await sequelize.query(`
      INSERT INTO payment_reconciliation_records
        (order_type, order_id, order_no, amount, currency_code, total_amount_thb,
         user_id, partner_id, order_created_at, swept_at, reconcile_status, created_at, updated_at)
      SELECT
        CASE WHEN a.event = 'partner_order.timeout.swept' THEN 'partner' ELSE 'retail' END,
        CASE WHEN a.resource_id ~ '^[0-9]+$' THEN a.resource_id::int ELSE NULL END,
        a.detail->>'order_no',
        CASE WHEN (a.detail->>'total_amount') ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (a.detail->>'total_amount')::numeric ELSE NULL END,
        COALESCE(NULLIF(a.detail->>'currency_code',''), 'THB'),
        CASE WHEN (a.detail->>'total_amount_thb') ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (a.detail->>'total_amount_thb')::numeric ELSE NULL END,
        CASE WHEN (a.detail->>'user_id') ~ '^[0-9]+$' THEN (a.detail->>'user_id')::int ELSE NULL END,
        CASE WHEN (a.detail->>'partner_id') ~ '^[0-9]+$' THEN (a.detail->>'partner_id')::int ELSE NULL END,
        CASE WHEN NULLIF(a.detail->>'created_at','') IS NOT NULL
             THEN (a.detail->>'created_at')::timestamptz ELSE NULL END,
        CASE WHEN NULLIF(a.detail->>'swept_at','') IS NOT NULL
             THEN (a.detail->>'swept_at')::timestamptz ELSE NULL END,
        'pending',
        NOW(),
        NOW()
      FROM audit_logs a
      WHERE a.event IN ('order.timeout.swept', 'partner_order.timeout.swept')
        AND a.detail IS NOT NULL
        AND NULLIF(a.detail->>'order_no', '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM payment_reconciliation_records r
          WHERE r.order_no = a.detail->>'order_no'
        )
      ON CONFLICT (order_no) DO NOTHING
      RETURNING id
    `)
    const backfilled = Array.isArray(res) ? res.length : 0
    console.log(
      `✅ 支付对账台账已建立（存量回填 ${backfilled ?? 0} 条历史清扫单据）`
    )
  },

  async down (queryInterface, sequelize) {
    await sequelize.query(
      'DROP TABLE IF EXISTS payment_reconciliation_records'
    ).catch(() => {})
  }
}
