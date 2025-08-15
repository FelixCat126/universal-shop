import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import bcrypt from 'bcrypt'

const Administrator = sequelize.define('Administrator', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [3, 50]
    },
    comment: '管理员用户名'
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true,
    validate: {
      isEmail: true
    },
    comment: '管理员邮箱'
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      len: [6, 255],
      notEmpty: true
    },
    comment: '密码哈希'
  },
  role: {
    type: DataTypes.ENUM('super_admin', 'admin', 'operator'),
    allowNull: false,
    defaultValue: 'operator',
    comment: '角色：super_admin=超级管理员, admin=管理员, operator=操作员'
  },
  real_name: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '真实姓名'
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '联系电话'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '是否启用'
  },
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '最后登录时间'
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '创建者ID'
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
  }
}, {
  tableName: 'administrators',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  hooks: {
    // 保存前自动加密密码
    beforeCreate: async (admin) => {
      if (admin.password) {
        const saltRounds = 10
        admin.password = await bcrypt.hash(admin.password, saltRounds)
      }
    },
    beforeUpdate: async (admin) => {
      if (admin.changed('password')) {
        const saltRounds = 10
        admin.password = await bcrypt.hash(admin.password, saltRounds)
      }
    }
  }
})

// 实例方法：验证密码
Administrator.prototype.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password)
}

// 序列化管理员信息（排除密码）
Administrator.prototype.toSafeJSON = function() {
  const { password, ...safeData } = this.toJSON()
  return safeData
}

// 检查权限
Administrator.prototype.hasPermission = function(resource) {
  const rolePermissions = {
    super_admin: ['*'], // 所有权限
    admin: ['orders', 'users', 'products', 'administrators'], // 除了操作日志
    operator: ['orders', 'users', 'products'] // 只能访问基本功能
  }
  
  const permissions = rolePermissions[this.role] || []
  return permissions.includes('*') || permissions.includes(resource)
}

export default Administrator
