/**
 * 生产环境安全的日志系统
 * 替换所有console.log调用，支持不同环境的日志级别
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
}

class Logger {
  constructor() {
    this.logLevel = this.getLogLevel()
    this.isProduction = process.env.NODE_ENV === 'production'
  }

  getLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase()
    return LOG_LEVELS[envLevel] ?? (this.isProduction ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG)
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString()
    const baseMessage = `[${timestamp}] ${level}: ${message}`
    
    if (data && !this.isProduction) {
      return `${baseMessage} ${JSON.stringify(data, null, 2)}`
    }
    
    return baseMessage
  }

  error(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.ERROR) {
      console.error(this.formatMessage('ERROR', message, data))
    }
  }

  warn(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.WARN) {
      console.warn(this.formatMessage('WARN', message, data))
    }
  }

  info(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.INFO) {
      console.log(this.formatMessage('INFO', message, data))
    }
  }

  debug(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.DEBUG) {
      console.log(this.formatMessage('DEBUG', message, data))
    }
  }

  // 安全的敏感信息日志（生产环境不输出）
  sensitive(message, data = null) {
    if (!this.isProduction && this.logLevel >= LOG_LEVELS.DEBUG) {
      console.log(this.formatMessage('SENSITIVE', message, data))
    }
  }

  // HTTP请求日志（生产环境简化）
  http(method, path, status = null, responseTime = null) {
    const message = this.isProduction 
      ? `${method} ${path}${status ? ` ${status}` : ''}`
      : `${method} ${path}${status ? ` ${status}` : ''}${responseTime ? ` ${responseTime}ms` : ''}`
    
    this.info(message)
  }
}

// 创建全局实例
const logger = new Logger()

export default logger

// 便捷的导出函数
export const { error, warn, info, debug, sensitive, http } = logger
