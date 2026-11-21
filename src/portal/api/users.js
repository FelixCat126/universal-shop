/**
 * @typedef {import('../../types/api').User} User
 * @typedef {import('../../types/api').UserPointBalance} UserPointBalance
 * @typedef {import('../../types/api').PointTransaction} PointTransaction
 * @typedef {import('../../types/api').UserRegisterRequest} UserRegisterRequest
 * @typedef {import('../../types/api').UserLoginRequest} UserLoginRequest
 * @typedef {import('../../types/api').UserProfileRequest} UserProfileRequest
 * @typedef {import('../../types/api').ChangePasswordRequest} ChangePasswordRequest
 * @typedef {import('../../types/api').DeleteAccountRequest} DeleteAccountRequest
 * @typedef {import('../../types/api').ForgotPasswordRequest} ForgotPasswordRequest
 * @typedef {import('../../types/api').ResetPasswordRequest} ResetPasswordRequest
 * @typedef {import('../../types/api').AuthTokenEnvelope} AuthTokenEnvelope
 * @typedef {import('../../types/api').ProfileMetricsEnvelope} ProfileMetricsEnvelope
 * @typedef {import('../../types/api').ReferralInfoEnvelope} ReferralInfoEnvelope
 * @typedef {import('../../types/api').PhoneExistsEnvelope} PhoneExistsEnvelope
 */
import axios from 'axios'
import { useUserStore } from '../stores/user.js'

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
      // Token过期或无效：同步清除 store 内存态与本地存储，并跳转登录页（带应用 base）
      const userStore = useUserStore()
      userStore.clearAuth()
      if (!window.location.pathname.includes('/login') &&
          !window.location.pathname.includes('/register')) {
        window.location.href = `${import.meta.env.BASE_URL || '/'}login`
      }
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

  getProfileMetrics: () => api.get(`${API_BASE_URL}/profile/metrics`),

  getPointTransactions: (params) => api.get(`${API_BASE_URL}/points/transactions`, { params }),

  /** 修改登录密码 body: { old_password, new_password } */
  changePassword: (body) => api.put(`${API_BASE_URL}/profile/password`, body)

  // 第 46 轮：删掉无人调用的 verifyReferralCode
  // （推荐码在注册/下单时直接提交，由服务端校验；前端不做预校验）
}

export default userAPI