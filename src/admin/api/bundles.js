import api from './index.js'

/** 后台组合套餐管理（固定组合包，挂 products 权限） */
export const bundleAPI = {
  list (params = {}) {
    return api.get('/admin/bundles', { params })
  },
  create (data) {
    return api.post('/admin/bundles', data)
  },
  update (id, data) {
    return api.put(`/admin/bundles/${id}`, data)
  },
  updateStatus (id, status) {
    return api.put(`/admin/bundles/${id}/status`, { status })
  },
  remove (id) {
    return api.delete(`/admin/bundles/${id}`)
  }
}

export default bundleAPI
