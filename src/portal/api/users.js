import axios from 'axios'

const API_BASE_URL = '/api/users'

// 创建axios实例
const api = axios.create({
  timeout: 10000,
})

// 请求拦截器 - 添加认证token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 统一错误处理
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token过期或无效，清除本地存储并跳转到登录页
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // window.location.href = '/login' // 这里可能需要根据路由调整
    }
    return Promise.reject(error)
  }
)

export const userAPI = {
  // 用户注册
  register: (userData) => {
    return api.post(`${API_BASE_URL}/register`, userData)
  },

  // 用户登录
  login: (credentials) => {
    return api.post(`${API_BASE_URL}/login`, credentials)
  },

  // 获取当前用户信息
  getCurrentUser: () => {
    return api.get(`${API_BASE_URL}/profile`)
  },

  // 验证推荐码
  verifyReferralCode: (code) => {
    return api.get(`${API_BASE_URL}/verify-referral/${code}`)
  }
}

export default userAPI