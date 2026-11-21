/**
 * @typedef {import('../../types/api').CouponTemplate} CouponTemplate
 * @typedef {import('../../types/api').UserCoupon} UserCoupon
 */
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
  },
  /**
   * 定向发券（补偿 / 活动 / 老客户维护）
   * @param {{ template_id: number, user_ids?: number[], user_id?: number, note?: string }} data
   */
  grant (data) {
    return api.post('/admin/coupons/grant', data)
  },
  /** 作废某一张已发出的券（只能作废未被使用的券） */
  voidInstance (id, reason) {
    return api.post(`/admin/coupons/instances/${id}/void`, { reason })
  }
}

export default couponAPI
