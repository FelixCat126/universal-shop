import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import Order from './Order.js'

/**
 * 订单促销快照表：记录某张订单实际命中的促销及减免金额
 * 快照语义：name/amount 落库后不再随 promotions 表变更（促销可被硬删，本表不随动）
 */
const OrderPromotion = sequelize.define('OrderPromotion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Order,
      key: 'id'
    },
    comment: '订单ID（orders.id；无 DB 级联，订单硬删时随单清理由删除方控制器/超时清扫服务显式处理）'
  },
  promotion_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '促销ID（仅逻辑关联 promotions.id：促销允许硬删，本表存快照，不建外键约束；抵扣券快照行该列为 NULL）'
  },
  user_coupon_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '用户券ID（P2 抵扣券快照行；仅逻辑关联 user_coupons.id，不建外键约束；满减快照行该列为 NULL）'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '促销名称快照'
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: '该促销在本订单的减免金额（THB 域）'
  }
}, {
  tableName: 'order_promotions',
  timestamps: true,
  underscored: true,
  comment: '订单促销快照表',
  indexes: [
    { fields: ['order_id'], name: 'idx_order_promotion_order_id' }
  ]
})

// 建立关联关系
OrderPromotion.belongsTo(Order, { foreignKey: 'order_id', as: 'order' })

export default OrderPromotion
