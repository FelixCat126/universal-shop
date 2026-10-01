import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 促销活动表（P1 营销体系 + P3 买多赠一）
 * 已实现 threshold（满减）与 buy_x_get_y（买多赠一）；rules/scope 用 JSONB 为后续 bundle 预留结构空间
 */
const Promotion = sequelize.define('Promotion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  type: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'threshold',
    comment: '促销类型：threshold-满减（P1）/ buy_x_get_y-买多赠一（P3）；预留 bundle'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '促销名称'
  },
  rules: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: '规则定义（threshold: { tiers: [{ min, off }] }，min 门槛金额 / off 减免金额，THB 域，off < min；buy_x_get_y: { buy, get, gift_product_id? }，买 buy 件赠 get 件，gift_product_id 缺省且 scope 恰为单商品时赠同品）'
  },
  scope: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: { type: 'all', ids: [] },
    comment: '适用范围：{ type: all|category|product, ids: [int] }；all 时忽略 ids'
  },
  start_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '生效开始时间（NULL 表示立即生效）'
  },
  end_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '生效结束时间（NULL 表示长期有效）'
  },
  priority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '优先级：多条候选满减互斥，取 priority 最高，平级取减免金额最大者'
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'active',
    comment: '状态：active-启用 / inactive-停用'
  }
}, {
  tableName: 'promotions',
  timestamps: true,
  underscored: true,
  comment: '促销活动表',
  indexes: [
    { fields: ['status'], name: 'idx_promotion_status' },
    { fields: ['priority'], name: 'idx_promotion_priority' }
  ]
})

export default Promotion
