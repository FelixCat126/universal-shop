import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 站内通知（第 54 轮）
 * =====================
 *
 * ## 为什么需要
 *
 * 排查发现：系统**完全没有出站通道** —— 订单发货、售后审核结论、积分变动、
 * 优惠券到账，用户**全部零感知**，只能自己反复刷订单页。
 * 运营在后台开着订单页 30 秒内就知道"新订单来了"，客户永远不知道"我的货已经发出去了"。
 *
 * 本轮先做**站内信**（不接邮件/短信/推送）：
 * 零外部依赖、零配置成本，且是后续所有触达通道的**共同底座**。
 *
 * ## 为什么只存 type + data，不存渲染好的文案
 *
 * 后端**没有 i18n 框架**（也没有 Accept-Language 处理）——
 * 如果后端把文案渲染成字符串再存，那通知就只能是**一种语言**，
 * 泰国用户会收到中文通知。
 *
 * 所以这里只存**结构化数据**：
 *   - `type`  —— 通知类型（决定前端怎么渲染）
 *   - `data`  —— 渲染需要的字段（订单号、商品名、金额…都是**快照**）
 *   - `link`  —— 站内跳转地址
 *
 * 前端按 `type` + 当前 locale 渲染（`src/portal/utils/notificationContent.js`），
 * 同一份通知对中/英/泰三种用户都正确。
 */
const Notification = sequelize.define(
  'Notification',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '接收人（users.id）'
    },
    type: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: '通知类型：order_status / after_sale / points / coupon / payment / system'
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: '渲染所需的结构化数据（订单号/商品名/金额等快照）'
    },
    link: {
      type: DataTypes.STRING(300),
      allowNull: true,
      comment: '站内跳转地址（如 /portal/orders/12）'
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否已读'
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '阅读时间'
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'notifications',
    timestamps: false,
    indexes: [
      { fields: ['user_id', 'is_read'], name: 'idx_notification_user_unread' },
      { fields: ['user_id', 'created_at'], name: 'idx_notification_user_created' }
    ]
  }
)

/** 通知类型取值（前后端契约） */
export const NOTIFICATION_TYPES = [
  'order_status',   // 订单状态变更（发货/送达/完成/取消）
  'after_sale',     // 售后审核结论
  'points',         // 积分变动（获取/退回/撤销/人工发放）
  'coupon',         // 优惠券到账
  'payment',        // 支付确认
  'system'          // 系统公告
]

export default Notification
