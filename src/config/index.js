/**
 * 配置管理器
 * 统一管理API地址，支持环境变量配置，确保开箱即用
 */
class ConfigManager {
  constructor() {
    this._apiBaseUrl = null
    this._staticBaseUrl = null
  }

  /**
   * 获取API基础URL
   * 优先级：环境变量 > 开发环境默认值 > 智能检测
   */
  get apiBaseUrl() {
    if (this._apiBaseUrl) {
      return this._apiBaseUrl
    }

    // 1. 优先使用环境变量（支持Vite的import.meta.env）
    try {
      // 使用全局变量检测避免语法错误
      const importMeta = globalThis.import?.meta || (typeof window !== 'undefined' && window.import?.meta)
      if (importMeta?.env?.VITE_API_BASE_URL) {
        this._apiBaseUrl = importMeta.env.VITE_API_BASE_URL
        return this._apiBaseUrl
      }
    } catch (e) {
      // 忽略检测错误
    }

    // 2. 检查传统的process.env（兼容性）
    if (typeof process !== 'undefined' && process.env?.VUE_APP_API_BASE_URL) {
      this._apiBaseUrl = process.env.VUE_APP_API_BASE_URL
      return this._apiBaseUrl
    }

    // 3. 开发环境默认值（保持现有行为）
    if (this.isDevelopment()) {
      this._apiBaseUrl = 'http://localhost:3000/api'
      return this._apiBaseUrl
    }

    // 4. 生产环境智能检测
    this._apiBaseUrl = `${this.detectProductionApiUrl()}/api`
    return this._apiBaseUrl
  }

  /**
   * 获取静态资源基础URL（图片等）
   */
  get staticBaseUrl() {
    if (this._staticBaseUrl) {
      return this._staticBaseUrl
    }

    // 静态资源通常与API服务在同一地址，但不包含/api前缀
    const apiUrl = this.apiBaseUrl
    this._staticBaseUrl = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl
    return this._staticBaseUrl
  }

  /**
   * 检测是否为开发环境
   */
  isDevelopment() {
    // Vite开发环境
    try {
      const importMeta = globalThis.import?.meta || (typeof window !== 'undefined' && window.import?.meta)
      if (importMeta?.env?.DEV) {
        return true
      }
    } catch (e) {
      // 忽略检测错误
    }
    
    // 传统NODE_ENV检测
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      return true
    }
    
    // 基于域名判断（localhost通常为开发环境）
    if (typeof window !== 'undefined') {
      return window.location.hostname === 'localhost' || 
             window.location.hostname === '127.0.0.1' ||
             window.location.hostname.startsWith('192.168.')
    }
    
    return false
  }

  /**
   * 生产环境API地址检测
   */
  detectProductionApiUrl() {
    if (typeof window === 'undefined') {
      return 'http://localhost:3000' // SSR fallback
    }

    // 默认使用当前域名
    const { protocol, hostname, port } = window.location
    
    // 如果当前是标准端口，尝试使用相同地址
    if (port === '' || port === '80' || port === '443') {
      return `${protocol}//${hostname}`
    }
    
    // 否则使用完整地址（包含端口）
    return `${protocol}//${hostname}:${port}`
  }

  /**
   * 构建完整的API URL
   * @param {string} path - API路径，如 '/products' 或 '/api/products'
   * @returns {string} 完整的URL
   */
  buildApiUrl(path) {
    if (!path) return this.apiBaseUrl
    
    // 如果已经是完整URL，直接返回
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path
    }
    
    // 确保路径以/开头
    let normalizedPath = path.startsWith('/') ? path : `/${path}`
    
    // 如果路径已经包含/api前缀，去掉它（因为apiBaseUrl已经包含了）
    if (normalizedPath.startsWith('/api/')) {
      normalizedPath = normalizedPath.substring(4) // 去掉'/api'
    }
    
    return `${this.apiBaseUrl}${normalizedPath}`
  }

  /**
   * 构建静态资源URL（图片等）
   * @param {string} path - 资源路径
   * @returns {string|null} 完整的URL或null
   */
  buildStaticUrl(path) {
    if (!path) return null
    
    // 如果已经是完整URL，直接返回
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path
    }
    
    // 确保路径以/开头
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    
    return `${this.staticBaseUrl}${normalizedPath}`
  }

  /**
   * 重置缓存（用于测试或动态配置变更）
   */
  reset() {
    this._apiBaseUrl = null
    this._staticBaseUrl = null
  }

  /**
   * 手动设置API地址（用于特殊场景）
   */
  setApiBaseUrl(url) {
    this._apiBaseUrl = url
  }

  /**
   * 获取当前配置信息（用于调试）
   */
  getDebugInfo() {
    return {
      apiBaseUrl: this.apiBaseUrl,
      staticBaseUrl: this.staticBaseUrl,
      isDevelopment: this.isDevelopment(),
      environment: {
        vite_api_url: (() => {
          try {
            const importMeta = globalThis.import?.meta || (typeof window !== 'undefined' && window.import?.meta)
            return importMeta?.env?.VITE_API_BASE_URL || 'not set'
          } catch (e) {
            return 'not available (Node.js)'
          }
        })(),
        process_env: typeof process !== 'undefined' ? process.env?.VUE_APP_API_BASE_URL : 'not available',
        location: typeof window !== 'undefined' ? window.location.href : 'not available'
      }
    }
  }
}

// 创建全局单例实例
const config = new ConfigManager()

// 导出实例和类
export { ConfigManager }
export default config

// 兼容性导出（支持CommonJS）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = config
  module.exports.ConfigManager = ConfigManager
}
