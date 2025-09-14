import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

const AdministrativeRegion = sequelize.define('AdministrativeRegion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  country_code: {
    type: DataTypes.STRING(2),
    allowNull: false,
    comment: '国家代码: TH, CN'
  },
  parent_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '父级ID，省级为NULL'
  },
  level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '级别: 1=省, 2=市, 3=区'
  },
  name_local: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '本地语言名称（泰语）'
  },
  name_alias: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '别名（英文）'
  },
  postal_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: '邮编，仅区级有值'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '排序'
  },
  is_active: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: '是否启用'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'administrative_regions',
  timestamps: false, // 我们手动管理时间戳字段
  indexes: [
    {
      name: 'idx_country_parent',
      fields: ['country_code', 'parent_id']
    },
    {
      name: 'idx_level',
      fields: ['level']
    },
    {
      name: 'idx_parent_sort',
      fields: ['parent_id', 'sort_order']
    },
    {
      name: 'idx_postal_code',
      fields: ['postal_code']
    }
  ]
})

// 定义自关联关系
AdministrativeRegion.hasMany(AdministrativeRegion, {
  foreignKey: 'parent_id',
  as: 'children'
})

AdministrativeRegion.belongsTo(AdministrativeRegion, {
  foreignKey: 'parent_id',
  as: 'parent'
})

// 实例方法：根据语言环境返回名称
AdministrativeRegion.prototype.getDisplayName = function(locale = 'th-TH') {
  return locale === 'th-TH' ? this.name_local : this.name_alias
}

// 静态方法：获取省份列表
AdministrativeRegion.getProvinces = function(countryCode = 'TH', locale = 'th-TH') {
  return this.findAll({
    where: {
      country_code: countryCode,
      level: 1,
      is_active: 1
    },
    order: [['sort_order', 'ASC']],
    attributes: [
      'id',
      'name_local',
      'name_alias',
      'postal_code',
      'level',
      [sequelize.literal(locale === 'th-TH' ? 'name_local' : 'name_alias'), 'name']
    ]
  })
}

// 静态方法：获取市区列表
AdministrativeRegion.getDistricts = function(provinceId, locale = 'th-TH') {
  return this.findAll({
    where: {
      parent_id: provinceId,
      level: 2,
      is_active: 1
    },
    order: [['sort_order', 'ASC']],
    attributes: [
      'id',
      'name_local',
      'name_alias',
      'postal_code',
      'level',
      [sequelize.literal(locale === 'th-TH' ? 'name_local' : 'name_alias'), 'name']
    ]
  })
}

// 静态方法：获取子区列表
AdministrativeRegion.getSubDistricts = function(districtId, locale = 'th-TH') {
  return this.findAll({
    where: {
      parent_id: districtId,
      level: 3,
      is_active: 1
    },
    order: [['sort_order', 'ASC']],
    attributes: [
      'id',
      'name_local',
      'name_alias',
      'postal_code',
      'level',
      [sequelize.literal(locale === 'th-TH' ? 'name_local' : 'name_alias'), 'name']
    ]
  })
}

// 静态方法：根据邮编查找区域
AdministrativeRegion.getByPostalCode = function(postalCode, locale = 'th-TH') {
  return this.findOne({
    where: {
      postal_code: postalCode,
      level: 3,
      is_active: 1
    },
    include: [
      {
        model: AdministrativeRegion,
        as: 'parent',
        include: [
          {
            model: AdministrativeRegion,
            as: 'parent'
          }
        ]
      }
    ]
  })
}

export default AdministrativeRegion
