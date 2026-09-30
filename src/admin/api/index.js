import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000
})

// 请求拦截：自动附带管理员令牌
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : ''
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：统一错误提示（保留原响应给调用方处理）
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // token 过期/无效：清空管理员凭据并跳转登录页（与 admin store 的 apiRequest 行为对齐）
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_info')
      if (typeof window !== 'undefined') {
        window.location.href = `${import.meta.env.BASE_URL || '/'}login`
      }
    }
    return Promise.reject(error)
  }
)

export default api


