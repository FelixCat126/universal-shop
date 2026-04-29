import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'
import Order from './Order.js'

const PointTransaction = sequelize.define('PointTransaction', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    },
    comment: '用户 ID'
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: Order,
      key: 'id'
    },
    comment: '关联订单（发放/扣减与订单对应）'
  },
  type: {
    type: DataTypes.STRING(24),
    allowNull: false,
    comment: 'earn_purchase | redeem_order'
  },
  delta: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '积分变动（正为增加，负为扣减）'
  },
  balance_after: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '变动后余额'
  },
  note: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'point_transactions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  comment: '积分流水（个人中心历史展示基础）',
  indexes: [
    { fields: ['user_id', 'created_at'], name: 'idx_point_tx_user_created' },
    { fields: ['order_id'], name: 'idx_point_tx_order' }
  ]
})

User.hasMany(PointTransaction, { foreignKey: 'user_id', as: 'pointTransactions' })
PointTransaction.belongsTo(User, { foreignKey: 'user_id', as: 'user' })
Order.hasMany(PointTransaction, { foreignKey: 'order_id', as: 'pointTransactions' })
PointTransaction.belongsTo(Order, { foreignKey: 'order_id', as: 'order' })

export default PointTransaction
