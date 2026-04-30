import api from './index.js'

// 创建订单
export const createOrder = (orderData) => {
  return api.post('/orders', orderData)
}

// 获取用户订单列表
export const getUserOrders = (params = {}) => {
  return api.get('/orders', { params })
}

// 获取订单详情
export const getOrderDetail = (orderId) => {
  return api.get(`/orders/${orderId}`)
}

// 在线支付：弹窗内确认后进入送货中等后续流程
export const confirmOnlinePayment = (orderId) => {
  return api.post(`/orders/${orderId}/confirm-online-payment`)
}

export default {
  createOrder,
  getUserOrders,
  getOrderDetail,
  confirmOnlinePayment
}