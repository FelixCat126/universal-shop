/**
 * 016_search_trgm_logs_categories —— 日志表 / 分类 / 推荐码 的搜索索引
 *
 * 背景（第 49 轮「效率」）：
 * 008 已经给订单/用户/合作方的关键词列加了 trigram 索引，但**还有几处前导通配符
 * 的 LIKE 查询没索引**，数据一上来就全表扫：
 *
 *   - 管理端行为审计：按事件名搜 `audit_logs.event LIKE '%kw%'`
 *     （事件名有 80 个取值，运营查"登录失败/超时清理"这类很常用）
 *   - 管理端操作日志：按动作搜 `operation_logs.action LIKE '%kw%'`
 *   - 管理端商品分类：按名称搜 `product_categories.name LIKE '%kw%'`
 *     （**这张表连一个普通索引都没有**，而它同时被前台列表 + 后台列表 + 导出用）
 *   - 管理端用户列表：按推荐码搜 `users.referred_by_code LIKE '%kw%'`、
 *     按邮箱搜 `users.email LIKE '%kw%'`（008 漏了这两列）
 *
 * 另外给**按时间清理**的列补索引：保留期清理任务每天按 `created_at` /
 * `updated_at` 扫描，而这些列只有复合索引的前缀用不上：
 *   - point_transactions.created_at（只有 (user_id,created_at) / (order_id)）
 *   - user_coupons.updated_at / expire_at
 *   - carts.updated_at
 *
 * 幂等：IF NOT EXISTS；pg_trgm 不可用时跳过（与 008 同一套降级）。
 */
export default {
  name: '016_search_trgm_logs_categories',
  async up (queryInterface, sequelize) {
    const [ext] = await sequelize.query(
      `SELECT n.nspname AS schema_name
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pg_trgm'`
    )
    const schema = ext?.[0]?.schema_name
    if (!schema) {
      console.warn('⚠️  pg_trgm 扩展不可用，跳过日志/分类搜索索引（搜索将走全表扫描）')
      return 'skipped'
    }
    /**
     * 第 57 轮：**这些单列 btree 索引与 pg_trgm 无关**（清理任务按时间列扫、
     * 分类按 sort_order 排），所以必须放在 trgm 检查**之前** ——
     * 之前它们在 trgm 的 skip 分支之后，pg_trgm 不可用时会被一起丢掉，
     * 分类排序就退化成全表扫。
     */
    // 清理任务按时间列扫描 → 补单列索引（复合索引的前缀用不上）
    const btreeTargets = [
      ['idx_point_transaction_created_at', 'point_transactions', 'created_at'],
      ['idx_user_coupon_updated_at', 'user_coupons', 'updated_at'],
      ['idx_user_coupon_expire_at', 'user_coupons', 'expire_at'],
      ['idx_cart_updated_at', 'carts', 'updated_at'],
      ['idx_product_category_sort_order', 'product_categories', 'sort_order'],
      ['idx_user_point_balance_balance', 'user_point_balances', 'balance']
    ]

    for (const [indexName, table, column] of btreeTargets) {
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} (${column})`
      ).catch((e) => {
        console.warn(`⚠️  ${indexName} 创建失败：${e.message}`)
      })
    }

    const opclass = `"${schema}".gin_trgm_ops`

    // 前导通配符 LIKE（%kw%）→ 需要 trigram，普通 btree 用不上
    const trgmTargets = [
      ['idx_audit_log_event_trgm', 'audit_logs', 'event'],
      ['idx_operation_log_action_trgm', 'operation_logs', 'action'],
      ['idx_product_category_name_trgm', 'product_categories', 'name'],
      ['idx_user_referred_by_code_trgm', 'users', 'referred_by_code'],
      ['idx_user_email_trgm', 'users', 'email']
    ]

    for (const [indexName, table, column] of trgmTargets) {
      try {
        await sequelize.query(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
           ON ${table} USING gin (${column} ${opclass})`
        )
      } catch (e) {
        console.warn(`⚠️  ${indexName} 并发建索引失败（${e.message}），改用普通建索引`)
        await sequelize.query(`DROP INDEX IF EXISTS ${indexName}`).catch(() => {})
        await sequelize.query(
          `CREATE INDEX IF NOT EXISTS ${indexName}
           ON ${table} USING gin (${column} ${opclass})`
        )
      }
    }

    for (const table of ['audit_logs', 'operation_logs', 'product_categories', 'users', 'point_transactions', 'user_coupons', 'carts', 'user_point_balances']) {
      await sequelize.query(`ANALYZE ${table}`).catch(() => {})
    }
    console.log('✅ 日志/分类/推荐码 搜索索引 + 清理时间列索引 已建立')
  },
  async down (queryInterface, sequelize) {
    for (const indexName of [
      'idx_user_email_trgm',
      'idx_user_referred_by_code_trgm',
      'idx_product_category_name_trgm',
      'idx_operation_log_action_trgm',
      'idx_audit_log_event_trgm',
      'idx_user_point_balance_balance',
      'idx_product_category_sort_order',
      'idx_cart_updated_at',
      'idx_user_coupon_expire_at',
      'idx_user_coupon_updated_at',
      'idx_point_transaction_created_at'
    ]) {
      await sequelize.query(`DROP INDEX IF EXISTS ${indexName}`).catch(() => {})
    }
  }
}
