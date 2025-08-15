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
    return Promise.reject(error)
  }
)

export default api


