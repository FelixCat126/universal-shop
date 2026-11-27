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
  comment: '商品类别表',
  /**
   * 第 57 轮补声明：分类按 sort_order 排序（门户分类 Tab 的顺序），
   * 之前索引只由迁移 016 建 —— 模型不声明的话，
   * 用 sequelize.sync 建出来的库（测试库/新库）就没有这个索引，
   * 与生产库不一致（生产是迁移建的）。
   */
  indexes: [
    {
      fields: ['sort_order'],
      name: 'idx_product_category_sort_order'
    }
  ]
})

export default ProductCategory
