import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import Order from './Order.js'
import Product from './Product.js'

const OrderItem = sequelize.define('OrderItem', {
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
    comment: '订单ID'
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Product,
      key: 'id'
    },
    comment: '商品ID'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '购买数量'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '购买时的商品单价（实际支付价格，已考虑折扣）'
  },
  original_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: '商品原价（未折扣前的价格）'
  },
  discount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '购买时的折扣百分比'
  },
  product_name_zh: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '商品中文名称快照'
  },
  product_name_th: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '商品泰文名称快照'
  }
}, {
  tableName: 'order_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '订单项表',
  indexes: [
    {
      fields: ['order_id']
    },
    {
      fields: ['product_id']
    }
  ]
})

// 建立关联关系
OrderItem.belongsTo(Order, { foreignKey: 'order_id', as: 'order' })
OrderItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' })

// 反向关联
Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items' })
Product.hasMany(OrderItem, { foreignKey: 'product_id', as: 'orderItems' })

export default OrderItem