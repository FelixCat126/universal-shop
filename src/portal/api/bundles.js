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
    // 套餐接口为公开接口，无需认证头
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
    return Promise.reject(error)
  }
)

// 组合套餐API（用户端，公开）
export const bundleAPI = {
  // 获取套餐列表（含组件摘要、单独购买总价、可售套数）
  getBundles (params = {}) {
    return api.get('/bundles', { params })
  },

  // 获取单个套餐详情
  getBundle (id) {
    return api.get(`/bundles/${id}`)
  }
}

export default api
