/**
 * 管理端积分管理 API
 *
 * 积分挂在用户资产上，所以这套接口与「用户管理」同属 users 权限域。
 */
import api from './index.js'

export const pointsAPI = {
  // 全局概览：用户数 / 总余额 / 总发放 / 总消耗
  getOverview: () => {
    return api.get('/admin/points/overview')
  },

  // 用户积分余额列表（分页 + 关键字/余额区间筛选）
  getUserBalances: (params) => {
    return api.get('/admin/points/users', { params })
  },

  // 某个用户的积分流水（分页）
  getUserTransactions: (userId, params) => {
    return api.get(`/admin/points/users/${userId}/transactions`, { params })
  },

  // 手工发放/扣减积分（delta 正数发放、负数扣减）
  adjustUserPoints: (userId, data) => {
    return api.post(`/admin/points/users/${userId}/adjust`, data)
  }
}

export default pointsAPI
