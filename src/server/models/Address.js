import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'

const Address = sequelize.define('Address', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    },
    comment: '用户ID'
  },
  contact_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '收货人姓名'
  },
  contact_phone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '收货人电话'
  },
  province: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '省份'
  },
  city: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '城市'
  },
  district: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '区县'
  },
  detail_address: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '详细地址'
  },
  full_address: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '完整地址'
  },
  postal_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: '邮政编码'
  },
  is_default: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '是否为默认地址'
  },
  address_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'home',
    comment: '地址类型: home-家庭, office-公司, other-其他'
  }
}, {
  tableName: 'addresses',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '收货地址表',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['is_default']
    }
  ]
})

// 建立关联关系
Address.belongsTo(User, { foreignKey: 'user_id', as: 'user' })
User.hasMany(Address, { foreignKey: 'user_id', as: 'addresses' })

export default Address