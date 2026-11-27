/**
 * 020_sms_logs —— 短信发送留痕
 *
 * ## 背景（第 55 轮）
 *
 * 短信是唯一一条"走不通就完全失联"的通道 ——
 * 站内信用户刷新就能看到；短信发没发、发没发到，用户只会说"没收到"。
 *
 * 客服要回答"到底发没发"，就得有一张留痕表：
 *   - status=sent    → 发出去了，问题在运营商
 *   - status=skipped + reason=cooldown → 被防轰炸挡了
 *   - status=skipped + reason=channel_not_configured → 通道压根没配
 *
 * ## 表设计要点
 *
 * - `message` 存**实际发送的文案快照**（不是模板 key）——
 *   排查时要看的就是"用户到底收到了什么字"
 * - `status` 三态（sent / failed / skipped）——把"没发"和"发失败"分开，
 *   两者的排查方向完全不同
 * - 索引：phone（查某个客户的短信）、template（按事件查）、created_at（按时间清理）、status
 *
 * 幂等：CREATE TABLE / CREATE INDEX IF NOT EXISTS。
 */
export default {
  name: '020_sms_logs',
  async up (queryInterface, sequelize) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS sms_logs (
        id           SERIAL PRIMARY KEY,
        phone        VARCHAR(32)  NOT NULL,
        country_code VARCHAR(8),
        template     VARCHAR(40),
        locale       VARCHAR(10),
        message      VARCHAR(500),
        status       VARCHAR(16)  NOT NULL DEFAULT 'sent',
        reason       VARCHAR(300),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)

    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_sms_log_phone ON sms_logs (phone)'
    ).catch((e) => console.warn(`⚠️  idx_sms_log_phone 创建失败：${e.message}`))
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_sms_log_template ON sms_logs (template)'
    ).catch((e) => console.warn(`⚠️  idx_sms_log_template 创建失败：${e.message}`))
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_sms_log_created ON sms_logs (created_at)'
    ).catch((e) => console.warn(`⚠️  idx_sms_log_created 创建失败：${e.message}`))
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_sms_log_status ON sms_logs (status)'
    ).catch((e) => console.warn(`⚠️  idx_sms_log_status 创建失败：${e.message}`))

    console.log('✅ 短信发送留痕表已建立（sms_logs）')
  },

  async down (queryInterface, sequelize) {
    await sequelize.query('DROP TABLE IF EXISTS sms_logs').catch(() => {})
  }
}
