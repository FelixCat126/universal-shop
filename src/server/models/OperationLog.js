import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

const OperationLog = sequelize.define('OperationLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '管理员ID'
  },
  admin_username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '管理员用户名（冗余存储，防止删除管理员后丢失记录）'
  },
  action: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '操作类型，如：create_order, update_user, delete_product等'
  },
  resource: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '操作的资源类型，如：order, user, product, administrator等'
  },
  resource_id: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '操作的资源ID'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '操作描述'
  },
  old_data: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '操作前的数据（JSON格式）'
  },
  new_data: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '操作后的数据（JSON格式）'
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true,
    comment: '操作IP地址'
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '用户代理字符串'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'operation_logs',
  timestamps: false, // 只需要created_at
  indexes: [
    {
      fields: ['admin_id']
    },
    {
      fields: ['action']
    },
    {
      fields: ['resource']
    },
    {
      fields: ['created_at']
    }
  ]
})

// 静态方法：记录操作日志
OperationLog.logOperation = async function(params) {
  const {
    adminId,
    adminUsername,
    action,
    resource,
    resourceId,
    description,
    oldData,
    newData,
    ipAddress,
    userAgent
  } = params
  
  try {
    await this.create({
      admin_id: adminId,
      admin_username: adminUsername,
      action,
      resource,
      resource_id: resourceId,
      description,
      old_data: oldData,
      new_data: newData,
      ip_address: ipAddress,
      user_agent: userAgent
    })
  } catch (error) {
    console.error('记录操作日志失败:', error)
    // 不抛出错误，避免影响主业务流程
  }
}

export default OperationLog
