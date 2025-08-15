import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'
import Product from './Product.js'

const Cart = sequelize.define('Cart', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // 允许匿名用户的购物车
    comment: '用户ID'
  },
  session_id: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '会话ID（用于匿名用户购物车）'
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '产品ID'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '数量'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '加入购物车时的价格'
  }
}, {
  tableName: 'carts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '购物车表',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['session_id']
    },
    {
      fields: ['product_id']
    },
    {
      unique: true,
      fields: ['user_id', 'product_id'],
      name: 'unique_user_product'
    }
  ]
})

// 定义关联关系
Cart.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
})

Cart.belongsTo(Product, {
  foreignKey: 'product_id',
  as: 'product'
})

export default Cart