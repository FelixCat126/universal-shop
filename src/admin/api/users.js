/**
 * @typedef {import('../../types/api').User} User
 */
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
  },

  /**
   * 管理端辅助重置客户密码。
   * 客户忘记密码时的自助重置依赖短信通道（线上没配 → 永远回不来），
   * 这里补上运营侧的兜底：临时密码 + 首次登录强制改密。
   */
  resetPassword: (userId) => {
    return api.put(`/admin/users/${userId}/password`)
  }
}

export default userAPI