/**
 * 012_point_archived_delta —— 记下"已归档的积分流水净额"
 *
 * 问题：retention 会清理 730 天前的积分流水（控制表体积），
 * 但**余额不动**（余额是用户资产，不能动）。
 * 于是不变量「积分余额 = 流水累计」在清理之后**永久不成立** ——
 * 每日体检从此一直报红，真实的问题反而被淹没。
 *
 * 而且这不止是体检噪音：该用户的 earn_purchase 流水已经没了 →
 * 取消他的老订单时 `earned = 0` → **已发放的积分收不回来**（白拿）。
 *
 * 修法：清理时把被删流水的净额（按用户汇总）累加到余额行的 `archived_delta`，
 * 于是「余额 = 剩余流水累计 + 已归档净额」**永远精确成立**，
 * 而且余额仍然是对的（用户的积分一分没少）。
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '012_point_archived_delta',
  async up (queryInterface, sequelize) {
    await sequelize.query(
      `ALTER TABLE user_point_balances ADD COLUMN IF NOT EXISTS archived_delta INTEGER NOT NULL DEFAULT 0`
    )
    console.log('✅ user_point_balances 已加 archived_delta（已归档流水净额）')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('ALTER TABLE user_point_balances DROP COLUMN IF EXISTS archived_delta')
  }
}
