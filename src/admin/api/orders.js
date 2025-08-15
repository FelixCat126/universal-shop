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
export const updateOrderStatus = (orderId, status) => {
  return api.put(`/admin/orders/${orderId}/status`, { status })
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
