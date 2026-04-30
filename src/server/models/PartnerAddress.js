import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import Partner from './Partner.js'

const PartnerAddress = sequelize.define('PartnerAddress', {
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
  recipient_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '收货人'
  },
  phone: {
    type: DataTypes.STRING(32),
    allowNull: false,
    comment: '电话（不含区号，纯数字）'
  },
  phone_country_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: '+66',
    validate: { isIn: [['+86', '+66', '+60']] },
    comment: '手机区号'
  },
  province: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '府（省）名称'
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '县（Amphoe）名称，对齐零售 Address.city'
  },
  district: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '子区/乡名称，对齐零售 Address.district'
  },
  postal_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: '邮编'
  },
  detail: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '详细地址'
  },
  label: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: '地址标签，如：默认仓'
  },
  is_default: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'partner_addresses',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ fields: ['partner_id', 'created_at'] }]
})

PartnerAddress.belongsTo(Partner, { foreignKey: 'partner_id', as: 'partner' })
Partner.hasMany(PartnerAddress, { foreignKey: 'partner_id', as: 'partnerAddresses' })

export default PartnerAddress
