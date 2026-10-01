import api from './index.js'

// 领券中心：可领取的券模板列表
export const getAvailableCoupons = () => {
  return api.get('/coupons/available')
}

// 领取券（body: { template_id }）
export const claimCoupon = (templateId) => {
  return api.post('/coupons/claim', { template_id: templateId })
}

// 我的券：status = unused | used | expired
export const getMyCoupons = (params = {}) => {
  return api.get('/coupons/mine', { params })
}

export default {
  getAvailableCoupons,
  claimCoupon,
  getMyCoupons
}
