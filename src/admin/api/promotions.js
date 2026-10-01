import api from './index.js'

/** 后台促销管理（满减等营销活动，挂 products 权限） */
export const promotionAPI = {
  list (params = {}) {
    return api.get('/admin/promotions', { params })
  },
  create (data) {
    return api.post('/admin/promotions', data)
  },
  update (id, data) {
    return api.put(`/admin/promotions/${id}`, data)
  },
  updateStatus (id, status) {
    return api.put(`/admin/promotions/${id}/status`, { status })
  },
  remove (id) {
    return api.delete(`/admin/promotions/${id}`)
  }
}

export default promotionAPI
