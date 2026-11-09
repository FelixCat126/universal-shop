import api from './index.js'

/**
 * @typedef {import('../../types/api').Order} Order
 * @typedef {import('../../types/api').OrderDetail} OrderDetail
 * @typedef {import('../../types/api').OrderBulkStatusRequest} OrderBulkStatusRequest
 * @typedef {import('../../types/api').OrderStatusRequest} OrderStatusRequest
 */

/**
 * @typedef {object} BulkStatusResult
 * @property {number[]} changed 已改动的订单 id
 * @property {Array<{id: number, status: string|null, reason: string}>} skipped 被跳过的订单及原因
 */

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

// 批量改订单状态（一次最多 200 个）
/**
 * @param {Array<number|string>} ids 订单 id 数组
 * @param {string} status 目标状态
 * @param {object} [extra] 可选的 tracking_number / admin_note
 * @returns {Promise<{data: {success: boolean, message: string, data: BulkStatusResult}}>}
 */
export const bulkUpdateOrderStatus = (ids, status, extra = {}) => {
  return api.post('/admin/orders/bulk/status', { ids, status, ...extra })
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
  bulkUpdateOrderStatus,
  deleteOrder,
  exportOrders
}
