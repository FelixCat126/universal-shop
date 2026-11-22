import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import bcrypt from 'bcrypt'
import { normalizeOptionalEmail } from '../utils/emptyToNull.js'

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
  token_version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '令牌版本：改密/重置时递增，旧 JWT 立即失效'
  },
  /**
   * 是否必须先改密才能使用后台。
   *
   * 用户端（users）与合作方端（partners）早就有同名字段与完整前端流程，
   * 管理员端此前**缺失** —— 生产实测发现后台账号仍在用出厂口令 123456，
   * 而管理员既没有"自己改密码"的入口，也没有强制改密的机制。
   */
  must_reset_password: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '首次登录是否强制改密（后台账号默认口令下线时置位）'
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
    /**
     * 邮箱是**选填**字段，但前端表单不填时提交的是空字符串 `''`。
     *
     * Sequelize 的 `isEmail` 校验只跳过 `null`/`undefined`，空字符串照样被拒
     * → 运营不填邮箱就建不了操作员，还被提示"邮箱格式不正确"（指向错误的字段）。
     *
     * 归一化成 `null` 后：校验被正确跳过，且**不占 email 的唯一键**
     * （多个"没填邮箱"的操作员互不冲突）。
     */
    beforeValidate: async (admin) => {
      if (admin.email !== undefined) {
        admin.email = normalizeOptionalEmail(admin.email)
      }
    },
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

/**
 * 角色 → 权限资源表（唯一权威定义）。
 * 中间件、控制器、前端展示都应引用这里，避免多处各写一份导致漂移。
 */
export const ROLE_PERMISSIONS = {
  super_admin: ['*'], // 所有权限
  admin: ['orders', 'users', 'products', 'administrators', 'partners'], // 除了操作日志
  operator: ['orders', 'users', 'products'] // 批发合作方仅限 admin/super_admin
}

/** 按角色判定权限（供非模型实例场景使用，如 req.admin 普通对象） */
export function hasPermissionByRole (role, resource) {
  const permissions = ROLE_PERMISSIONS[role] || []
  return permissions.includes('*') || permissions.includes(resource)
}

// 检查权限
Administrator.prototype.hasPermission = function(resource) {
  return hasPermissionByRole(this.role, resource)
}

export default Administrator
