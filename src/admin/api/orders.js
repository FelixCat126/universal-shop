import api from './index.js'

// 获取所有订单（管理员）
export const getOrders = (params = {}) => {
  return api.get('/admin/orders', { params })
}

// 获取订单详情
export const getOrderDetail = (orderId) => {
  return api.get(`/admin/orders/${orderId}`)
}

// 更新订单状态
/**
 * 改订单状态（可同时带履约信息：物流单号 / 内部备注）。
 * @param {number|string} orderId
 * @param {string|object} statusOrPayload 状态字符串，或完整 payload（含 tracking_number/admin_note）
 */
export const updateOrderStatus = (orderId, statusOrPayload) => {
  const payload = (typeof statusOrPayload === 'object' && statusOrPayload !== null)
    ? statusOrPayload
    : { status: statusOrPayload }
  return api.put(`/admin/orders/${orderId}/status`, payload)
}

// 删除订单
export const deleteOrder = (orderId) => {
  return api.delete(`/admin/orders/${orderId}`)
}

// 导出订单数据
export const exportOrders = (params = {}) => {
  return api.get('/admin/orders/export', { 
    params,
    responseType: 'blob'
  })
}

export default {
  getOrders,
  getOrderDetail,
  updateOrderStatus,
  deleteOrder,
  exportOrders
}
