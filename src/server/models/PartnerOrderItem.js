import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import PartnerOrder from './PartnerOrder.js'
import Product from './Product.js'

const PartnerOrderItem = sequelize.define('PartnerOrderItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  partner_order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: PartnerOrder, key: 'id' }
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: Product, key: 'id' }
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 }
  },
  base_unit_thb: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '零售等价泰铢单价（原价经商品折扣后）快照'
  },
  unit_price_thb: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '合作方折后单价'
  },
  line_total_thb: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  partner_discount_percent_snapshot: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: false,
    defaultValue: 0
  },
  product_name_snapshot: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  product_image_snapshot: {
    type: DataTypes.STRING(512),
    allowNull: true,
    comment: '商品主图快照'
  }
}, {
  tableName: 'partner_order_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['partner_order_id'] },
    { fields: ['product_id'] }
  ]
})

PartnerOrderItem.belongsTo(PartnerOrder, { foreignKey: 'partner_order_id', as: 'partnerOrder' })
PartnerOrderItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' })

PartnerOrder.hasMany(PartnerOrderItem, { foreignKey: 'partner_order_id', as: 'items' })

export default PartnerOrderItem
