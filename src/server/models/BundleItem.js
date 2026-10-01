import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import Bundle from './Bundle.js'
import Product from './Product.js'

/**
 * 组合包组件表（P4）：一个组合包含哪些商品、各多少件（配比）。
 * 同一组合包内 product_id 不重复（admin 层 joi 校验拦截）
 */
const BundleItem = sequelize.define('BundleItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  bundle_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Bundle,
      key: 'id'
    },
    comment: '组合包ID'
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Product,
      key: 'id'
    },
    comment: '组件商品ID'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: { min: 1 },
    comment: '组件配比数量（每个组合包含多少件该商品）'
  }
}, {
  tableName: 'bundle_items',
  timestamps: true,
  underscored: true,
  comment: '组合包组件表（P4）',
  indexes: [
    { fields: ['bundle_id'], name: 'idx_bundle_item_bundle' },
    { fields: ['product_id'], name: 'idx_bundle_item_product' }
  ]
})

// 建立关联关系
Bundle.hasMany(BundleItem, { foreignKey: 'bundle_id', as: 'items' })
BundleItem.belongsTo(Bundle, { foreignKey: 'bundle_id', as: 'bundle' })
BundleItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' })

export default BundleItem
