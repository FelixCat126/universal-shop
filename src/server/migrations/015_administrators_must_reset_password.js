/**
 * 015_administrators_must_reset_password —— 管理员首次登录强制改密
 *
 * ## 背景：生产实测发现的严重问题
 *
 * 第 33 轮安全彻查时，对**生产库**做了只读比对（不修改任何数据）：
 *
 *   管理员 admin   → 密码是否为默认 123456：❌ 是
 *   合作方 test    → 密码是否为默认 123456：❌ 是
 *   合作方 test1   → 密码是否为默认 123456：❌ 是
 *
 * 即：**生产上所有管理端/合作方账号都在用出厂弱口令**。
 * 站点在公网（eshop.cider-bar.com），知道默认口令的人登录一次即成功 ——
 * 这不是"弱密码建议"，是可直接利用的凭据泄露。
 *
 * ## 为什么客户端和合作方端没有这个问题
 *
 * users / partners 表**早就**有 `must_reset_password` 字段，
 * 前端也各自实现了"强制跳改密页 + 改密后清标志"的完整流程
 * （portal 的横幅、partner 的路由守卫）。
 * 但 **administrators 表没有这个字段**，前端也没有任何改密入口
 * —— 只有一句 i18n 文案"首次登录后请立即修改密码"，从来没被实现。
 *
 * 本迁移把这条**已经存在却不适用于管理员端**的机制补上。
 *
 * ## 语义
 *
 * - 默认 false：不影响任何现有账号（迁移本身不改行为）
 * - 置 true 后：该管理员**除改密/登出外**的所有管理接口都返回 403
 *   （code = PASSWORD_CHANGE_REQUIRED），前端据此强制跳改密页
 * - 改密成功后清标志，并递增 token_version 让旧令牌立即失效
 *
 * 幂等：列已存在就跳过。
 */
export default {
  name: '015_administrators_must_reset_password',
  async up (queryInterface, sequelize) {
    const rows = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'administrators'
          AND column_name = 'must_reset_password'`
    )
    const list = Array.isArray(rows?.[0]) ? rows[0] : (rows || [])
    const first = list[0]
    const exists = (first && typeof first === 'object' && !Array.isArray(first))
      ? (first.column_name ?? first[0])
      : first
    if (exists) {
      console.log('ℹ️  administrators.must_reset_password 已存在，跳过')
      return
    }
    await sequelize.query(
      `ALTER TABLE administrators
         ADD COLUMN must_reset_password BOOLEAN NOT NULL DEFAULT FALSE`
    )
    console.log('✅ administrators 已加 must_reset_password（管理员首次登录可强制改密）')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query(
      'ALTER TABLE administrators DROP COLUMN IF EXISTS must_reset_password'
    ).catch(() => {})
  }
}
