import api from './index.js'

/** 后台抵扣券模板管理（挂 products 权限） */
export const couponAPI = {
  list (params = {}) {
    return api.get('/admin/coupon-templates', { params })
  },
  create (data) {
    return api.post('/admin/coupon-templates', data)
  },
  update (id, data) {
    return api.put(`/admin/coupon-templates/${id}`, data)
  },
  updateStatus (id, status) {
    return api.put(`/admin/coupon-templates/${id}/status`, { status })
  },
  remove (id) {
    return api.delete(`/admin/coupon-templates/${id}`)
  },
  instances (id, params = {}) {
    return api.get(`/admin/coupon-templates/${id}/instances`, { params })
  }
}

export default couponAPI
