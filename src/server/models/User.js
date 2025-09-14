import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import bcrypt from 'bcrypt'

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true,
    comment: '用户名（现在与手机号保持一致）'
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  nickname: {
    type: DataTypes.STRING(50),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 50]
    },
    comment: '用户昵称'
  },
  country_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: '+86',
    validate: {
      isIn: [['+86', '+66', '+60']],
      notEmpty: true
    },
    comment: '国家区号（+86中国，+66泰国，+60马来西亚）'
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      notEmpty: true,
      isPhoneValid(value) {
        // 验证手机号格式（纯数字，不能以0开头）
        const phoneRegex = /^[1-9]\d+$/
        if (!phoneRegex.test(value)) {
          throw new Error('手机号必须为纯数字且不能以0开头')
        }
        
        // 根据国家区号验证位数
        const countryCode = this.country_code
        let minLength
        let countryName
        switch (countryCode) {
          case '+86': // 中国
            minLength = 11
            countryName = '中国'
            break
          case '+60': // 马来西亚
            minLength = 9
            countryName = '马来西亚'
            break
          case '+66': // 泰国
            minLength = 9
            countryName = '泰国'
            break
          default:
            throw new Error('不支持的国家区号')
        }
        
        if (value.length < minLength) {
          throw new Error(`${countryName}手机号必须不少于${minLength}位数字`)
        }
      }
    },
    comment: '手机号（不包含区号）'
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      len: [6, 255],
      notEmpty: true
    }
  },
  referral_code: {
    type: DataTypes.STRING(20),
    allowNull: true,
    unique: true,
    comment: '用户的推荐码（自动生成）'
  },
  referred_by_code: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '注册时填写的推荐码'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '用户状态：true-启用，false-禁用'
  },
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '最后登录时间'
  }
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // 复合唯一索引：国家区号+手机号组合唯一
    {
      unique: true,
      fields: ['country_code', 'phone'],
      name: 'unique_country_phone'
    }
  ],
  hooks: {
    // 保存前自动加密密码
    beforeCreate: async (user) => {
      if (user.password) {
        const saltRounds = 10
        user.password = await bcrypt.hash(user.password, saltRounds)
      }
      // 生成唯一推荐码
      if (!user.referral_code) {
        user.referral_code = generateReferralCode()
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const saltRounds = 10
        user.password = await bcrypt.hash(user.password, saltRounds)
      }
    }
  }
})

// 生成推荐码
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 实例方法：验证密码
User.prototype.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password)
}

// 类方法：通过推荐码查找用户
User.findByReferralCode = async function(referralCode) {
  return await this.findOne({
    where: { referral_code: referralCode }
  })
}

// 类方法：通过国家区号+手机号查找用户
User.findByCountryAndPhone = async function(countryCode, phone) {
  return await this.findOne({
    where: { 
      country_code: countryCode,
      phone: phone 
    }
  })
}

// 序列化用户信息（排除密码）
User.prototype.toSafeJSON = function() {
  const { password, ...safeData } = this.toJSON()
  return safeData
}

export default User