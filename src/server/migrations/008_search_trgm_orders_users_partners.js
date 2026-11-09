/**
 * 008_search_trgm_orders_users_partners —— 订单/用户/合作方的搜索索引
 *
 * 注：007 是留给"users.must_change_password"的 —— 后来发现 users 表**早就有**
 * must_reset_password（游客自动注册/密码重置一直在用），新加一列是重复，
 * 所以 007 作废、这个迁移顺延成 008。**序号有空洞是正常的**（作废的迁移不删编号，
 * 免得已部署的机器把它当成"新迁移"重跑）。
 *
 * 背景：004/005/006/007 已经给**商品**加了 trigram 索引，但其它几张表
 * 的关键词搜索还是前导通配符的 LIKE（`%kw%`）→ btree 用不上 → 全表扫。
 *
 *   管理端订单列表：按单号/收货人/电话搜，或按用户的昵称/手机号/用户名搜
 *   管理端用户列表：按昵称/邮箱/手机号/推荐码搜
 *   管理端合作方列表：按登录名/商家名称搜
 *
 * 这些都是"运营找一笔单/一个客户"的高频动作，量一上来就卡。
 *
 * 顺带把**幂等键**也索引上：(user_id, client_order_key) 已有部分唯一索引，
 * 但 orders 的 client_order_id 单独查（幂等预检）走的就是那个索引，不用重复。
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '008_search_trgm_orders_users_partners',
  async up (queryInterface, sequelize) {
    const [ext] = await sequelize.query(
      `SELECT n.nspname AS schema_name
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pg_trgm'`
    )
    const schema = ext?.[0]?.schema_name
    if (!schema) {
      console.warn('⚠️  pg_trgm 扩展不可用，跳过订单/用户/合作方搜索索引（搜索将走全表扫描）')
      return
    }
    const opclass = `"${schema}".gin_trgm_ops`

    const targets = [
      ['idx_order_order_no_trgm', 'orders', 'order_no'],
      ['idx_order_contact_name_trgm', 'orders', 'contact_name'],
      ['idx_order_contact_phone_trgm', 'orders', 'contact_phone'],
      ['idx_user_nickname_trgm', 'users', 'nickname'],
      ['idx_user_phone_trgm', 'users', 'phone'],
      ['idx_user_username_trgm', 'users', 'username'],
      ['idx_partner_login_trgm', 'partners', 'login'],
      ['idx_partner_display_name_trgm', 'partners', 'display_name']
    ]

    for (const [indexName, table, column] of targets) {
      try {
        await sequelize.query(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
           ON ${table} USING gin (${column} ${opclass})`
        )
      } catch (e) {
        // CONCURRENTLY 失败 → 清掉可能残留的 invalid 索引 → 退回普通建索引
        console.warn(`⚠️  ${indexName} 并发建索引失败（${e.message}），改用普通建索引`)
        await sequelize.query(`DROP INDEX IF EXISTS ${indexName}`).catch(() => {})
        await sequelize.query(
          `CREATE INDEX IF NOT EXISTS ${indexName}
           ON ${table} USING gin (${column} ${opclass})`
        )
      }
    }

    await sequelize.query('ANALYZE orders')
    await sequelize.query('ANALYZE users')
    await sequelize.query('ANALYZE partners')
    console.log('✅ orders / users / partners 已加 trigram 搜索索引')
  },
  async down (queryInterface, sequelize) {
    for (const indexName of [
      'idx_partner_display_name_trgm',
      'idx_partner_login_trgm',
      'idx_user_username_trgm',
      'idx_user_phone_trgm',
      'idx_user_nickname_trgm',
      'idx_order_contact_phone_trgm',
      'idx_order_contact_name_trgm',
      'idx_order_order_no_trgm'
    ]) {
      await sequelize.query(`DROP INDEX IF EXISTS ${indexName}`).catch(() => {})
    }
  }
}
