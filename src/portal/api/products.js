import axios from 'axios'
import config from '../../config/index.js'

// 创建axios实例
const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 10000
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token
    const token = localStorage.getItem('user-token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    
    // 添加语言标识
    const language = localStorage.getItem('language') || 'th-TH'
    config.headers['Accept-Language'] = language
    
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
      localStorage.removeItem('user-token')
      // 可以跳转到登录页面
    }
    return Promise.reject(error)
  }
)

// 产品API（用户端）
export const productAPI = {
  // 获取产品列表（分页）
  getProducts(params = {}) {
    return api.get('/products', { params })
  },

  // 获取单个产品详情
  getProduct(id) {
    return api.get(`/products/${id}`)
  },

  // 搜索产品
  searchProducts(keyword, params = {}) {
    return api.get('/products', { 
      params: { 
        ...params, 
        name: keyword 
      } 
    })
  }
}

export default api