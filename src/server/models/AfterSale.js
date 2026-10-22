import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

const AfterSale = sequelize.define('AfterSale', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联订单'
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '申请人（订单所属用户）'
  },
  type: {
    type: DataTypes.ENUM('refund', 'return'),
    allowNull: false,
    comment: 'refund=仅退款，return=退货退款'
  },
  reason: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: '申请原因'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'received'),
    allowNull: false,
    defaultValue: 'pending',
    comment: 'pending=待审核，approved=已同意，rejected=已拒绝，received=已退货入库'
  },
  admin_note: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '管理员审核备注'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'after_sales',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['order_id'] },
    { fields: ['user_id', 'status'] },
    { fields: ['status', 'created_at'] }
  ]
})

export default AfterSale
