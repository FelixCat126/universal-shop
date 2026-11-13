/**
 * 010_list_query_indexes —— 列表查询补索引
 *
 * 背景：这轮在**生产库实测**（EXPLAIN ANALYZE）发现四条高频查询走**全表扫描 + 排序**：
 *
 *   1. 管理端订单列表：ORDER BY created_at DESC LIMIT 20
 *      → Seq Scan + Sort（orders 表没有 created_at 索引）
 *   2. 用户「我的订单」：WHERE user_id=? ORDER BY created_at DESC
 *      → Seq Scan + Sort（只有 (user_id, client_order_key) 复合索引，前缀可用但排序仍要额外排）
 *   3. 导出 worker 每 15 秒扫一次 pending 任务
 *      → Seq Scan on export_jobs（status 没索引，只有 (admin_id, status)）
 *
 * 合作方订单列表（partner_id + created_at）**已有索引**
 * （PartnerOrder 模型 indexes 声明），不用重复建。
 *
 * 生产数据量小（orders 9 行）时看不出差别，但这些表**只增不减**：
 * 订单量到 10 万行时，第 1 条会从毫秒级变成几百毫秒 + 排序落盘，
 * 而管理端订单页是**每 30 秒自动刷新**一次 —— 等于持续给数据库加压。
 *
 * 为什么用 CONCURRENTLY：普通 CREATE INDEX 会拿 ACCESS EXCLUSIVE 锁，
 * 建索引期间订单表整个动不了（改价/下单/取消全被挡住）。
 *
 * CONCURRENTLY 的两个约束（与 004/006 同样处理）：
 *   - 不能在事务里跑（迁移执行器本来就不包事务，OK）
 *   - 失败可能留下 invalid 索引 → 先删残留再退回普通建索引
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '010_list_query_indexes',
  async up (queryInterface, sequelize) {
    /**
     * 建 btree 索引（CONCURRENTLY 优先，失败退回普通建法）。
     * @param {string} name 索引名
     * @param {string} sql 完整的 CREATE INDEX 语句（不含 CONCURRENTLY）
     */
    const createIndex = async (name, sql) => {
      try {
        await sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ${sql}`)
      } catch (e) {
        console.warn(`⚠️  ${name} 并发建索引失败（${e.message}），改用普通建索引`)
        await sequelize.query(`DROP INDEX IF EXISTS ${name}`).catch(() => {})
        await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ${sql}`)
      }
    }

    // 管理端订单列表：最新优先
    await createIndex(
      'idx_orders_created_at_desc',
      `ON orders (created_at DESC)`
    )

    // 用户「我的订单」：某个用户的订单按时间倒序
    await createIndex(
      'idx_orders_user_created_at',
      `ON orders (user_id, created_at DESC)`
    )

    /**
     * 合作方订单列表：**已有索引**（PartnerOrder 模型 indexes 声明的
     * (partner_id, created_at) → idx_partner_orders_partner_id_created_at），
     * 不要重复建 —— 重复索引只会白占写入开销与存储。
     */

    /**
     * 导出 worker 每 15 秒扫一次 pending 任务。
     *
     * 用**部分索引**：只索引 pending 的行 —— 索引极小（几 KB），
     * 扫描代价几乎为零；done/failed 的历史任务（会一直累积）完全不进索引。
     */
    await createIndex(
      'idx_export_jobs_pending',
      `ON export_jobs (id) WHERE status = 'pending'`
    )

    console.log('✅ 已补列表查询索引（orders / export_jobs）')
  },
  async down (queryInterface, sequelize) {
    for (const name of [
      'idx_orders_created_at_desc',
      'idx_orders_user_created_at',
      'idx_export_jobs_pending'
    ]) {
      await sequelize.query(`DROP INDEX IF EXISTS ${name}`).catch(() => {})
    }
  }
}
