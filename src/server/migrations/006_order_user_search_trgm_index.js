/**
 * 006_order_user_search_trgm_index —— 订单/用户搜索改用 trigram 索引
 *
 * 背景：管理端订单列表的关键词搜索、以及下单前按用户名/昵称找用户，
 * 都是**前导通配符的 LIKE**（`%kw%`）—— btree 索引用不上，PG 只能全表扫。
 *
 * 实测（5 万订单 + 2 万用户）：
 *   用户 LIKE（昵称/手机/用户名）  2.6ms → 0.6ms
 *   订单 LIKE（单号/收货人/电话）  8.0ms → 1.8ms
 * 索引体积代价：orders 14MB / users 7.5MB（含全部索引，5 万/2 万行）—— 可接受。
 *
 * 为什么不用全文检索（FTS）：泰文没有空格分词、中文不分词，
 * FTS 的分词器对这两种语言都不适用；trigram 不依赖分词，跨语言通用。
 *
 * 已有的 btree 索引**保留**：order_no 的精确/前缀查询、phone 的精确查询
 * 仍然走 btree（比 trigram 更快），两者服务的是不同查询形态。
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '006_order_user_search_trgm_index',
  async up (queryInterface, sequelize) {
    const [ext] = await sequelize.query(
      `SELECT n.nspname AS schema_name
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pg_trgm'`
    )
    const schema = ext?.[0]?.schema_name
    if (!schema) {
      console.warn('⚠️  pg_trgm 扩展不可用，跳过订单/用户搜索索引（搜索将走全表扫描）')
      return
    }
    const opclass = `"${schema}".gin_trgm_ops`

    const targets = [
      ['idx_order_order_no_trgm', 'orders', 'order_no'],
      ['idx_order_contact_name_trgm', 'orders', 'contact_name'],
      ['idx_order_contact_phone_trgm', 'orders', 'contact_phone'],
      ['idx_user_nickname_trgm', 'users', 'nickname'],
      ['idx_user_phone_trgm', 'users', 'phone'],
      ['idx_user_username_trgm', 'users', 'username']
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
    console.log('✅ orders / users 已加 trigram 搜索索引')
  },
  async down (queryInterface, sequelize) {
    for (const indexName of [
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
