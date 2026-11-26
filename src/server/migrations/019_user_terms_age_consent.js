/**
 * 019_user_terms_age_consent —— 用户条款与年龄确认
 *
 * ## 背景（第 54 轮）
 *
 * 本系统**没有任何有效方式核实注册人身份**（没有证件验证、没有第三方实名、
 * 连手机号都不是短信验证的 —— 只有密码重置才走短信）。
 *
 * 那就不能假装能核实。可商用商城能做且应该做的是：
 * **让用户在系统内明确确认**（自我声明 + 条款可见 + 留痕），
 * 并在政策与界面上**如实说明**核实能力的边界。
 *
 * 泰国对含尼古丁产品的销售有年龄限制（20 岁），
 * 而本项目的主力品类正是这类商品 —— 没有年龄确认就是**直接踩线**。
 *
 * ## 字段
 *
 * - `terms_accepted_at` —— 用户确认同意服务条款/退换货政策/隐私政策的时间
 * - `age_confirmed_at`  —— 用户确认已满最低购买年龄的时间
 *
 * **两个都允许为 NULL**：历史账号（迁移前注册的）没有这些记录，
 * 不能因为老用户没勾过就让他们无法下单。
 * 新的注册/下单则由 Joi 强制要求传确认标记。
 *
 * ## 为什么存时间戳而不是布尔
 *
 * 布尔只能回答"同意过"，时间戳还能回答"什么时候同意的"——
 * 条款可能更新（`terms_version` 概念），届时"用旧版本同意的"要能识别出来。
 *
 * 幂等：ADD COLUMN IF NOT EXISTS。
 */
export default {
  name: '019_user_terms_age_consent',
  async up (queryInterface, sequelize) {
    await sequelize.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ'
    )
    await sequelize.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at TIMESTAMPTZ'
    )
    console.log('✅ users 已加 terms_accepted_at / age_confirmed_at（条款与年龄确认留痕）')
  },

  async down (queryInterface, sequelize) {
    await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_at').catch(() => {})
    await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS age_confirmed_at').catch(() => {})
  }
}
