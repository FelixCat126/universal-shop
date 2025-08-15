// API配置
const getBaseUrl = () => {
  // 生产环境自动检测
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location
    
    // 开发环境
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000'
    }
    
    // 生产环境 - 使用当前页面的协议和主机
    if (port && port !== '80' && port !== '443') {
      return `${protocol}//${hostname}:${port}`
    } else {
      return `${protocol}//${hostname}`
    }
  }
  return 'http://localhost:3000'
}

export const API_CONFIG = {
  // API服务器地址
  BASE_URL: getBaseUrl(),
  
  // API端点
  ENDPOINTS: {
    // 管理员相关
    ADMIN_LOGIN: '/api/admin/login',
    ADMIN_VALIDATE: '/api/admin/validate-token',
    ADMIN_LIST: '/api/admin/administrators',
    OPERATION_LOGS: '/api/admin/operation-logs',
    
    // 统计相关
    STATISTICS_OVERVIEW: '/api/admin/statistics/overview',
    STATISTICS_ORDER_TREND: '/api/admin/statistics/order-trend',
    STATISTICS_USER_TREND: '/api/admin/statistics/user-trend',
    STATISTICS_COMPREHENSIVE: '/api/admin/statistics/comprehensive',
    
    // 其他API
    PRODUCTS: '/api/products',
    ORDERS: '/api/admin/orders',
    USERS: '/api/admin/users'
  }
}

// 构建完整的API URL
export const buildApiUrl = (endpoint) => {
  return `${API_CONFIG.BASE_URL}${endpoint}`
}

// 默认的fetch配置
export const defaultFetchOptions = {
  headers: {
    'Content-Type': 'application/json'
  }
}

export default API_CONFIG
