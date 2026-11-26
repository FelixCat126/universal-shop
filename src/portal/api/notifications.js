/**
 * 站内信 API（第 54 轮）
 */
import api from './index.js'

export const notificationAPI = {
  /** 列表（unreadOnly=true 只看未读） */
  list (params = {}) {
    return api.get('/notifications', { params })
  },

  /** 未读数（铃铛角标） */
  unreadCount () {
    return api.get('/notifications/unread-count')
  },

  /** 标记单条已读 */
  markRead (id) {
    return api.put(`/notifications/${id}/read`)
  },

  /** 全部标记已读 */
  markAllRead () {
    return api.put('/notifications/read-all')
  }
}

export default notificationAPI
