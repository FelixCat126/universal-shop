/**
 * 009_partner_must_reset_password —— 合作方「首次登录必须改密」标记
 *
 * 背景：合作方账号有两条创建路径
 *   - 管理端手工创建（管理员自己定密码）
 *   - **CSV 批量导入**（系统生成随机初始密码，运营线下告知）
 *
 * 第二条路径有个真实的洞：初始密码是运营口头传达的，
 * 合作方拿到后**没有任何接口可以改**（门户里没有改密页，接口也没有），
 * 于是这个临时密码会一直有效下去 —— 谁拿到都能用。
 *
 * 与用户侧（users.must_reset_password）对齐：新增同一列，
 * 登录时带回标记 → 门户强制跳改密页 → 改完清标记。
 *
 * 幂等：IF NOT EXISTS；老合作方默认 false（不受影响，不用改密码）。
 */
export default {
  name: '009_partner_must_reset_password',
  async up (queryInterface, sequelize) {
    await sequelize.query(
      `ALTER TABLE partners ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE`
    )
    console.log('✅ partners 已加 must_reset_password')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query(
      `ALTER TABLE partners DROP COLUMN IF EXISTS must_reset_password`
    )
  }
}
