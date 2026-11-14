/**
 * 013_users_last_login_at_index —— 用户表补 last_login_at 索引
 *
 * 背景：这轮在**生产库实测**（EXPLAIN + pg_indexes 逐列核对）发现：
 *
 *   仪表盘「近七天活跃用户数」：
 *     SELECT COUNT(*) FROM users
 *      WHERE last_login_at >= ? AND last_login_at IS NOT NULL
 *     → users 表**没有 last_login_at 索引** → 每次面板打开都全表扫 users
 *
 * users 是这个系统里**增长最快**的表（注册 + 游客自动注册都在往里写），
 * 而仪表盘是运营每天必开、且**每 30 秒自动刷新**的页面 ——
 * 等于按用户数增长的速率，持续给数据库加压。
 *
 * 为什么用 CONCURRENTLY：普通 CREATE INDEX 会拿 ACCESS EXCLUSIVE 锁，
 * 建索引期间 users 表整个动不了（登录/注册/下单全被挡住）。
 *
 * CONCURRENTLY 的两个约束（与 004/006/010 同样处理）：
 *   - 不能在事务里跑（迁移执行器本来就不包事务，OK）
 *   - 失败可能留下 invalid 索引 → 先删残留再退回普通建索引
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '013_users_last_login_at_index',
  async up (queryInterface, sequelize) {
    const name = 'idx_users_last_login_at'
    try {
      await sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON users (last_login_at)`)
    } catch (e) {
      console.warn(`⚠️  ${name} 并发建索引失败（${e.message}），改用普通建索引`)
      await sequelize.query(`DROP INDEX IF EXISTS ${name}`).catch(() => {})
      await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON users (last_login_at)`)
    }
    console.log('✅ users 已补 last_login_at 索引（仪表盘「近七天活跃用户」不再全表扫）')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('DROP INDEX IF EXISTS idx_users_last_login_at').catch(() => {})
  }
}
