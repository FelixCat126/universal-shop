import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  order_no: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '订单号'
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    },
    comment: '用户ID'
  },
  total_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '订单总金额'
  },
  payment_method: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'cod',
    comment: '支付方式: cod-货到付款, online-在线付款'
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
    comment: '订单状态: pending-待支付, paid-已支付, shipped-已发货, delivered-已送达, cancelled-已取消'
  },
  contact_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '收货人姓名'
  },
  contact_phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '收货人电话'
  },
  delivery_address: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '收货地址'
  },
  province: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '省份'
  },
  city: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '城市'
  },
  district: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '区县'
  },
  postal_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: '邮政编码'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '订单备注'
  },
  exchange_rate: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    defaultValue: 1.0000,
    comment: '下单时汇率（用于金额显示）'
  }
}, {
  tableName: 'orders',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '订单表',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['order_no']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    }
  ]
})

// 建立关联关系
Order.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default Order