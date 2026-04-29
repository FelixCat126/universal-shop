import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 商品类别（后台可增删改；产品表通过 category_id 外键关联）
 */
const ProductCategory = sequelize.define('ProductCategory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '类别名称（前台 Tab 与后台展示）'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '排序，越小越靠前'
  }
}, {
  tableName: 'product_categories',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '商品类别表'
})

export default ProductCategory
