import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 短信发送留痕（第 55 轮）
 * =========================
 *
 * ## 为什么需要这张表
 *
 * 短信是**唯一一条走不通就完全失联**的通道 ——
 * 站内信用户刷新就能看到，短信发没发、发没发到，用户只会说"没收到"。
 *
 * 没有留痕时，客服只能靠猜：
 *   - 是系统没触发？
 *   - 触发了但被防轰炸挡了？
 *   - 发出去了但运营商没送达？
 *
 * 有了这张表，"没收到"这个问题 30 秒内能答：
 * `status=sent` → 发出去了，问题在运营商；
 * `status=skipped` + `reason=cooldown` → 被冷却挡了；
 * `status=skipped` + `reason=channel_not_configured` → 通道压根没配。
 *
 * ## status 取值
 *
 * - `sent`     —— 通道返回成功
 * - `failed`   —— 通道报错/超时（reason 里记原因）
 * - `skipped`  —— 根本没发（reason 说明为什么：cooldown / channel_not_configured）
 */
const SmsLog = sequelize.define(
  'SmsLog',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    phone: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: '收件号码（不含区号）'
    },
    country_code: {
      type: DataTypes.STRING(8),
      allowNull: true,
      comment: '区号'
    },
    template: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: '模板 key（如 order_shipped）'
    },
    locale: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: '发送时用的语言'
    },
    message: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '实际发送的文案（快照）'
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'sent',
      comment: 'sent / failed / skipped'
    },
    reason: {
      type: DataTypes.STRING(300),
      allowNull: true,
      comment: '失败或跳过的原因'
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'sms_logs',
    timestamps: false,
    indexes: [
      { fields: ['phone'], name: 'idx_sms_log_phone' },
      { fields: ['template'], name: 'idx_sms_log_template' },
      { fields: ['created_at'], name: 'idx_sms_log_created' },
      { fields: ['status'], name: 'idx_sms_log_status' }
    ]
  }
)

export default SmsLog
