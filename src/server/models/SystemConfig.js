import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

const SystemConfig = sequelize.define('SystemConfig', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  config_key: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: '配置项键名'
  },
  config_value: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '配置项值'
  },
  config_type: {
    type: DataTypes.ENUM('text', 'image', 'json', 'boolean'),
    allowNull: false,
    defaultValue: 'text',
    comment: '配置项类型'
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '配置项描述'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '是否启用'
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
  tableName: 'system_configs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
})

// 静态方法：获取配置值
SystemConfig.getConfig = async function(key, defaultValue = null) {
  try {
    const config = await this.findOne({
      where: {
        config_key: key,
        is_active: true
      }
    })
    
    if (!config) {
      return defaultValue
    }
    
    // 根据类型返回相应格式的值
    switch (config.config_type) {
      case 'json':
        try {
          return JSON.parse(config.config_value)
        } catch {
          return defaultValue
        }
      case 'boolean':
        return config.config_value === 'true'
      default:
        return config.config_value
    }
  } catch (error) {
    console.error('获取系统配置失败:', error)
    return defaultValue
  }
}

// 静态方法：设置配置值
SystemConfig.setConfig = async function(key, value, type = 'text', description = null) {
  try {
    // 根据类型处理值
    let configValue = value
    if (type === 'json') {
      configValue = JSON.stringify(value)
    } else if (type === 'boolean') {
      configValue = value ? 'true' : 'false'
    }
    
    const [config, created] = await this.findOrCreate({
      where: { config_key: key },
      defaults: {
        config_key: key,
        config_value: configValue,
        config_type: type,
        description,
        is_active: true
      }
    })
    
    if (!created) {
      config.config_value = configValue
      config.config_type = type
      if (description) {
        config.description = description
      }
      await config.save()
    }
    
    return config
  } catch (error) {
    console.error('设置系统配置失败:', error)
    throw error
  }
}

// 静态方法：删除配置
SystemConfig.deleteConfig = async function(key) {
  try {
    const result = await this.destroy({
      where: { config_key: key }
    })
    return result > 0
  } catch (error) {
    console.error('删除系统配置失败:', error)
    throw error
  }
}

// 静态方法：获取所有配置
SystemConfig.getAllConfigs = async function() {
  try {
    const configs = await this.findAll({
      where: { is_active: true },
      order: [['config_key', 'ASC']]
    })
    
    const result = {}
    configs.forEach(config => {
      let value = config.config_value
      
      // 根据类型转换值
      switch (config.config_type) {
        case 'json':
          try {
            value = JSON.parse(value)
          } catch {
            value = null
          }
          break
        case 'boolean':
          value = value === 'true'
          break
      }
      
      result[config.config_key] = {
        value,
        type: config.config_type,
        description: config.description
      }
    })
    
    return result
  } catch (error) {
    console.error('获取所有系统配置失败:', error)
    throw error
  }
}

export default SystemConfig
