import axios from 'axios'
import config from '../../config/index.js'

/**
 * API 基址**用共享的那一份**（src/config/index.js）。
 *
 * 原来这里自己抄了一份判断（"localhost 或 127.0.0.1 → localhost:3000"），
 * 与共享配置、admin/config/api.js 三处各说各话 ——
 * 结果就是「同一份构建在不同域名下行为不同」，很难查。
 * 现在只有 src/config/index.js 一个地方说了算。
 */
const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 10000
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token
    const token = localStorage.getItem('admin_token')
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
      // 处理未授权错误（与 admin store 的 apiRequest 行为对齐）
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_info')
      window.location.href = `${import.meta.env.BASE_URL || '/'}login`
    }
    return Promise.reject(error)
  }
)

// 产品API
export const productAPI = {
  // 前台分类列表（下拉用）
  getProductCategories () {
    return api.get('/product-categories')
  },

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

  // 下架产品（逻辑删除）
  deleteProduct(id) {
    return api.delete(`/products/${id}`)
  },

  // 重新上架（取消软删除）
  restoreProduct(id) {
    return api.post(`/products/${id}/restore`)
  },

  // 调整库存
  adjustStock(id, data) {
    return api.post(`/products/${id}/stock`, data)
  }
}

export default api