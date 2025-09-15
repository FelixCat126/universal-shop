import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '产品名称'
  },
  alias: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '产品别名'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '产品描述'
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'others',
    comment: '产品分类'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '产品价格'
  },
  discount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    validate: {
      min: 0,
      max: 100
    },
    comment: '折扣百分比(0-100)'
  },
  stock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '库存数量'
  },
  image: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '产品图片URL'
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
    comment: '产品状态'
  }
}, {
  tableName: 'products',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '产品信息表'
})

export default Product