import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 固定组合包表（P4）：虚拟商品，固定几个组件商品 × 各自配比数量，一个组合价（THB）。
 * 组合包本身无库存概念：可售性 = 全部组件库存足够（min floor(stock/配比)）；
 * 下单时由计价引擎展开为组件行，组合价按组件直降价权重分摊到行
 */
const Bundle = sequelize.define('Bundle', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '组合包名称'
  },
  name_th: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '组合包泰文名称'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '组合包描述'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '组合价（泰铢 THB）'
  },
  image: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '组合包图片URL'
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'active',
    comment: '状态：active-启用 / inactive-停用'
  }
}, {
  tableName: 'bundles',
  timestamps: true,
  underscored: true,
  comment: '固定组合包表（P4）',
  indexes: [
    { fields: ['status'], name: 'idx_bundle_status' }
  ]
})

export default Bundle
