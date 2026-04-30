import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import bcrypt from 'bcrypt'

const Partner = sequelize.define('Partner', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  login: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    validate: { notEmpty: true, len: [2, 64] },
    comment: '合作方登录名'
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'bcrypt 密码哈希'
  },
  display_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  account_kind: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'dealer',
    validate: { isIn: [['dealer', 'agent']] },
    comment: '账号类别 dealer-经销商 agent-代理'
  },
  discount_percent: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0, max: 100 },
    comment: '统一折扣（百分比）应用于零售等价泰铢底价之后'
  },
  tier_discount_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '二期：阶梯折扣 JSON'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'partners',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  hooks: {
    beforeCreate: async (row) => {
      if (row.password && !row.password.startsWith('$2')) {
        row.password = await bcrypt.hash(row.password, 10)
      }
    },
    beforeUpdate: async (row) => {
      if (row.changed('password') && row.password && !row.password.startsWith('$2')) {
        row.password = await bcrypt.hash(row.password, 10)
      }
    }
  }
})

Partner.prototype.validatePassword = async function (plain) {
  return bcrypt.compare(plain, this.password)
}

Partner.prototype.toSafeJSON = function () {
  const { password, ...rest } = this.toJSON()
  return rest
}

export default Partner
