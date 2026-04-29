import api from './index.js'

/** 后台类别管理 */
export const categoryAdminAPI = {
  list (params = {}) {
    return api.get('/admin/product-categories', { params })
  },
  create (data) {
    return api.post('/admin/product-categories', data)
  },
  update (id, data) {
    return api.put(`/admin/product-categories/${id}`, data)
  },
  remove (id) {
    return api.delete(`/admin/product-categories/${id}`)
  }
}

export default categoryAdminAPI
