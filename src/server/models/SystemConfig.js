import { DataTypes } from 'sequelize'
import { LRUCache } from 'lru-cache'
import sequelize from '../config/database.js'
import { logger } from '../utils/logger.js'

/**
 * getConfig 进程内短缓存（TTL 10s，max 200）：
 * quote/下单/partner MOQ/汇率等热路径每请求重复读同几行配置，短 TTL 摊薄重复 DB 读。
 * 失效矩阵：
 *   - setConfig / deleteConfig（本文件内全部写入口，控制器与 app.js 启动写均经此）→ 写后立即 delete 对应键
 *   - 绕过模型方法的直写（seeds 脚本、运维 SQL）→ 不感知，最长 10s 自然过期
 *   - 聚合读 getAllConfigs（管理端全量/公开聚合）不走缓存，始终实时，与逐键缓存天然一致
 * 缓存的是解析后的值；对象值读出时 structuredClone 一份，防调用方原地改污染缓存。
 * 未命中/已停用/JSON 解析失败统一按 CONFIG_MISS 缓存，返回调用方各自 defaultValue。
 * 测试环境整体旁路：测试库 beforeEach TRUNCATE 复用数据，缓存会跨用例泄漏。
 */
const isTestEnv = process.env.NODE_ENV === 'test'
const configCache = new LRUCache({ max: 200, ttl: 10_000 })
const CONFIG_MISS = Symbol('config_miss')

const cloneConfigValue = (v) => (v !== null && typeof v === 'object' ? structuredClone(v) : v)

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

// 静态方法：获取配置值（10s 进程内缓存，见文件头注释）
SystemConfig.getConfig = async function(key, defaultValue = null) {
  try {
    if (!isTestEnv) {
      const cached = configCache.get(key)
      if (cached !== undefined) {
        return cached === CONFIG_MISS ? defaultValue : cloneConfigValue(cached)
      }
    }

    const config = await this.findOne({
      where: {
        config_key: key,
        is_active: true
      }
    })

    let value = CONFIG_MISS
    if (config) {
      // 根据类型返回相应格式的值
      switch (config.config_type) {
        case 'json':
          try {
            value = JSON.parse(config.config_value)
          } catch {
            value = CONFIG_MISS
          }
          break
        case 'boolean':
          value = config.config_value === 'true'
          break
        default:
          value = config.config_value
      }
    }

    if (!isTestEnv) configCache.set(key, value)
    return value === CONFIG_MISS ? defaultValue : cloneConfigValue(value)
  } catch (error) {
    logger.error('获取系统配置失败', { err: error?.message, stack: error?.stack })
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

    // 写后立即使对应缓存键失效，热路径下一读即新值（含 findOrCreate 新建分支）
    configCache.delete(key)

    return config
  } catch (error) {
    logger.error('设置系统配置失败', { err: error?.message, stack: error?.stack })
    throw error
  }
}

// 静态方法：删除配置
SystemConfig.deleteConfig = async function(key) {
  try {
    const result = await this.destroy({
      where: { config_key: key }
    })
    // 删除后立即使对应缓存键失效
    configCache.delete(key)
    return result > 0
  } catch (error) {
    logger.error('删除系统配置失败', { err: error?.message, stack: error?.stack })
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
    logger.error('获取所有系统配置失败', { err: error?.message, stack: error?.stack })
    throw error
  }
}

export default SystemConfig
