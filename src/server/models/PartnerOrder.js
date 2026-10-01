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
  },
  online_paid_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '合作方在线支付确认时间；用于支付确认接口幂等'
  },
  /**
   * 客户端幂等键：下单请求超时重试时防双单。
   * (partner_id, client_order_key) WHERE client_order_key IS NOT NULL 的部分唯一索引
   * 由启动链 DDL 兜底（不在模型 indexes 声明，避免与手工 DDL 重名双建）。
   */
  client_order_key: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: '客户端幂等键（每合作方唯一，可空）'
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
