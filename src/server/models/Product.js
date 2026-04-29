import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import ProductCategory from './ProductCategory.js'

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
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '产品分类 ID（product_categories.id）',
    references: {
      model: 'product_categories',
      key: 'id'
    }
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '产品价格（泰铢 THB）'
  },
  points: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
    comment: '购买所需积分（0 表示不启用积分兑换）'
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
  paranoid: true,
  deletedAt: 'deleted_at',
  comment: '产品信息表',
  indexes: [
    // 商品分类索引（用于分类筛选）
    {
      fields: ['category_id'],
      name: 'idx_product_category_id'
    },
    // 价格索引（用于价格排序和筛选）
    {
      fields: ['price'],
      name: 'idx_product_price'
    },
    // 商品状态索引（用于状态筛选）
    {
      fields: ['status'],
      name: 'idx_product_status'
    },
    // 库存索引（用于库存筛选）
    {
      fields: ['stock'],
      name: 'idx_product_stock'
    },
    // 商品名称索引（用于搜索）
    {
      fields: ['name'],
      name: 'idx_product_name'
    },
    // 创建时间索引（用于排序）
    {
      fields: ['created_at'],
      name: 'idx_product_created_at'
    },
    // 复合索引：状态+分类（常用组合查询）
    {
      fields: ['status', 'category_id'],
      name: 'idx_product_status_category_id'
    },
    {
      fields: ['deleted_at'],
      name: 'idx_product_deleted_at'
    }
  ]
})

Product.belongsTo(ProductCategory, {
  foreignKey: 'category_id',
  as: 'productCategory'
})

export default Product