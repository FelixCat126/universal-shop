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
    // 用户ID索引（用于用户订单查询）
    {
      fields: ['user_id'],
      name: 'idx_order_user_id'
    },
    // 订单号唯一索引（用于订单查找）
    {
      unique: true,
      fields: ['order_no'],
      name: 'idx_order_no'
    },
    // 订单状态索引（用于状态筛选）
    {
      fields: ['status'],
      name: 'idx_order_status'
    },
    // 创建时间索引（用于时间排序）
    {
      fields: ['created_at'],
      name: 'idx_order_created_at'
    },
    // 复合索引：用户ID+创建时间（用户订单列表查询）
    {
      fields: ['user_id', 'created_at'],
      name: 'idx_order_user_created'
    },
    // 复合索引：状态+创建时间（管理端订单列表）
    {
      fields: ['status', 'created_at'],
      name: 'idx_order_status_created'
    },
    // 联系电话索引（用于查找订单）
    {
      fields: ['contact_phone'],
      name: 'idx_order_contact_phone'
    }
  ]
})

// 建立关联关系
Order.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default Order