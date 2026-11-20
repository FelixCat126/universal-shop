/**
 * @typedef {import('../../types/api').Order} Order
 * @typedef {import('../../types/api').OrderDetail} OrderDetail
 */
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

/**
 * 用户自助取消订单（第 45 轮）。
 * 后端一直只有管理端能取消 → 客户想取消自己的订单只能联系运营，
 * 而积分退回 / 抵扣券退还也只有管理员能触发。
 * @param {number|string} orderId
 */
export const cancelOrder = (orderId) => {
  return api.post(`/orders/${orderId}/cancel`)
}

/**
 * 申请售后（第 45 轮补上客户端入口）。
 * 后端接口一直都在，但客户端**从没调用过** → 客户根本没法发起售后。
 * @param {number|string} orderId
 * @param {{ type: 'refund'|'return', reason: string }} payload
 */
export const createAfterSale = (orderId, payload) => {
  return api.post(`/orders/${orderId}/after-sales`, payload)
}

/**
 * 我的售后单（第 45 轮）：让客户能看到自己提交的售后单被处理成什么状态。
 * 后端同样早就有了这个接口，客户端也没有入口 → 客户提交完只能干等。
 */
export const getMyAfterSales = () => {
  return api.get('/orders/after-sales/mine')
}

export default {
  createOrder,
  getUserOrders,
  getOrderDetail,
  confirmOnlinePayment,
  cancelOrder,
  createAfterSale,
  getMyAfterSales
}