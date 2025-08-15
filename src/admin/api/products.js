import axios from 'axios'

// 获取API基础URL
const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location
    
    // 开发环境
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000/api'
    }
    
    // 生产环境 - 使用当前页面的协议和主机
    if (port && port !== '80' && port !== '443') {
      return `${protocol}//${hostname}:${port}/api`
    } else {
      return `${protocol}//${hostname}/api`
    }
  }
  return 'http://localhost:3000/api'
}

// 创建axios实例
const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 10000
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token
    const token = localStorage.getItem('admin-token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    console.error('API请求失败:', error)
    if (error.response?.status === 401) {
      // 处理未授权错误
      localStorage.removeItem('admin-token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// 产品API
export const productAPI = {
  // 获取产品列表
  getProducts(params = {}) {
    return api.get('/products', { params })
  },

  // 获取单个产品
  getProduct(id) {
    return api.get(`/products/${id}`)
  },

  // 创建产品
  createProduct(data) {
    return api.post('/products', data)
  },

  // 更新产品
  updateProduct(id, data) {
    return api.put(`/products/${id}`, data)
  },

  // 删除产品
  deleteProduct(id) {
    return api.delete(`/products/${id}`)
  },

  // 调整库存
  adjustStock(id, data) {
    return api.post(`/products/${id}/stock`, data)
  }
}

export default api