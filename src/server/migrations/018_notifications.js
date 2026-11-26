/**
 * 018_notifications —— 站内通知表
 *
 * ## 背景（第 54 轮）
 *
 * 系统**完全没有出站通道**：订单发货、售后审核结论、积分变动、优惠券到账，
 * 用户**全部零感知**，只能自己反复刷订单页。
 *
 * 运营在后台开着订单页 30 秒内就知道"新订单来了"；
 * 客户永远不知道"我的货已经发出去了" —— 这是可商用商城的硬伤。
 *
 * 本轮先做**站内信**（不接邮件/短信/推送）：零外部依赖、零配置成本，
 * 且是后续所有触达通道的共同底座。
 *
 * ## 表设计要点
 *
 * - `type` + `data`(JSONB) + `link`，**不存渲染好的文案**：
 *   后端没有 i18n 框架，存文案会导致通知只有一种语言；
 *   存结构化数据后，前端按当前 locale 渲染，中/英/泰都正确。
 * - `data` 里的订单号/商品名/金额是**快照**：
 *   商品改名改价后，历史通知仍显示当时的值（这才是"凭据"该有的样子）。
 * - 索引 `(user_id, is_read)` 服务于未读数角标（高频查询）。
 *
 * 幂等：CREATE TABLE / CREATE INDEX IF NOT EXISTS。
 */
export default {
  name: '018_notifications',
  async up (queryInterface, sequelize) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER      NOT NULL,
        type       VARCHAR(40)  NOT NULL,
        data       JSONB,
        link       VARCHAR(300),
        is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
        read_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)

    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_notification_user_unread ON notifications (user_id, is_read)'
    ).catch((e) => console.warn(`⚠️  idx_notification_user_unread 创建失败：${e.message}`))

    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_notification_user_created ON notifications (user_id, created_at)'
    ).catch((e) => console.warn(`⚠️  idx_notification_user_created 创建失败：${e.message}`))

    console.log('✅ 站内通知表已建立（notifications）')
  },

  async down (queryInterface, sequelize) {
    await sequelize.query('DROP TABLE IF EXISTS notifications').catch(() => {})
  }
}
