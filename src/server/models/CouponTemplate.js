import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 抵扣券模板表（P2 营销体系）
 * scope 与 promotions.scope 同构：{ type: all|category|product, ids: [int] }
 * 面额/门槛均在 THB 域；门槛按单品直降后、满减前的行小计口径判定（见 pricingEngine 第 3 层）
 */
const CouponTemplate = sequelize.define('CouponTemplate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '券名称'
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '面额（THB）；核销时封顶不超过满减后应付金额'
  },
  min_spend: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: '使用门槛（THB，0=无门槛；按 scope 内行满减前小计之和判定）'
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '发行总量（NULL=不限）'
  },
  per_user: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '每人限领张数（含已用/已过期的历史领取）'
  },
  valid_from: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '生效开始时间（NULL=立即生效）'
  },
  valid_to: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '生效结束时间（NULL=长期有效）；领取出的券 expire_at 取该值'
  },
  scope: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: { type: 'all', ids: [] },
    comment: '适用范围（同 promotions.scope）：{ type: all|category|product, ids: [int] }；all 时忽略 ids'
  },
  register_gift: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '注册赠券：新用户创建成功后自动发放 1 张（跳过每人限领，保留总量检查）'
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'active',
    comment: '状态：active-启用 / inactive-停用'
  }
}, {
  tableName: 'coupon_templates',
  timestamps: true,
  underscored: true,
  comment: '抵扣券模板表',
  indexes: [
    { fields: ['status'], name: 'idx_coupon_template_status' }
  ]
})

export default CouponTemplate
