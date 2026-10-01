import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'
import CouponTemplate from './CouponTemplate.js'

/**
 * 用户抵扣券实例表（P2 营销体系）
 * 状态机：unused（未使用）→ used（下单核销，条件 UPDATE 占位防并发重用）
 *               → expired（惰性过期：查询时发现 expire_at 已过即置位）
 *        used → unused：订单取消/删除/超时清扫时经 restoreOrderResources 释放
 * used_by_order_id 仅逻辑关联 orders.id：订单允许硬删，不建外键约束（释放先于删单完成）
 */
const UserCoupon = sequelize.define('UserCoupon', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  template_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: CouponTemplate,
      key: 'id'
    },
    comment: '模板ID（coupon_templates.id）'
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    },
    comment: '持有用户ID（users.id）'
  },
  code: {
    type: DataTypes.STRING(24),
    allowNull: false,
    unique: true,
    comment: '券码：CP + 10 位大写随机（领取时生成，撞唯一约束重试）'
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'unused',
    comment: '状态：unused-未使用 / used-已使用 / expired-已过期'
  },
  used_by_order_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '核销订单ID（仅逻辑关联 orders.id，不建外键；订单取消/删除时置 NULL 释放）'
  },
  expire_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '过期时间（领取时取模板 valid_to；NULL=长期有效）'
  },
  used_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '核销时间（下单占位成功时刻）'
  }
}, {
  tableName: 'user_coupons',
  timestamps: true,
  underscored: true,
  comment: '用户抵扣券实例表',
  indexes: [
    { fields: ['user_id', 'status'], name: 'idx_user_coupon_user_status' },
    { fields: ['template_id'], name: 'idx_user_coupon_template_id' },
    // 订单取消/删除/超时清扫按 used_by_order_id 释放券（restoreOrderResources 的条件 UPDATE）
    { fields: ['used_by_order_id'], name: 'idx_user_coupons_used_by_order' }
  ]
})

// 建立关联关系
UserCoupon.belongsTo(CouponTemplate, { foreignKey: 'template_id', as: 'template' })
UserCoupon.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default UserCoupon
