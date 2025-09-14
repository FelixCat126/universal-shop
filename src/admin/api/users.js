import api from './index.js'

const API_BASE_URL = '/users'

export const userAPI = {
  // 获取用户列表（管理端）
  getAllUsers: (params) => {
    return api.get(`/admin/users`, { params })
  },

  // 验证推荐码
  verifyReferralCode: (code) => {
    return api.get(`${API_BASE_URL}/verify-referral/${code}`)
  },

  // 获取用户地址列表（管理端）
  getUserAddresses: (userId) => {
    return api.get(`/admin/users/${userId}/addresses`)
  }
}

export default userAPI