import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import Partner from './Partner.js'

const PartnerOrder = sequelize.define('PartnerOrder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  partner_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: Partner, key: 'id' },
    comment: '合作方 ID'
  },
  order_no: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  currency_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'THB'
  },
  total_amount_thb: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  status: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'submitted',
    comment: 'pending_payment|submitted|processing|shipped|settled|cancelled'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  contact_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  contact_phone: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  delivery_address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  partner_address_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '选用的合作方保存地址 ID（仅存引用，快照在 contact_/delivery_*）'
  }
}, {
  tableName: 'partner_orders',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['partner_id', 'created_at'] },
    { fields: ['status'] }
  ]
})

PartnerOrder.belongsTo(Partner, { foreignKey: 'partner_id', as: 'partner' })
Partner.hasMany(PartnerOrder, { foreignKey: 'partner_id', as: 'partnerOrders' })

export default PartnerOrder
