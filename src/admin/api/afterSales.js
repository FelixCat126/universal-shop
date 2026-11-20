/**
 * @typedef {import('../../types/api').AfterSale} AfterSale
 */
import api from './index.js'

/**
 * 售后单管理（第 45 轮补上管理端入口）。
 *
 * 后端这两个接口一直都在（adminRoutes.js），
 * 但管理端**没有任何页面调用它们** → 用户提交的售后单在后台"看不见、审不了"。
 */
export const afterSaleAPI = {
  /** 列表（可按状态筛选；后端上限 200 条） */
  list (params = {}) {
    return api.get('/admin/after-sales', { params })
  },
  /**
   * 审核：approved=同意（退款/退货退款）、rejected=驳回、received=确认收货入库。
   * 后端只放行 admin/super_admin（资损级操作）。
   */
  review (id, status, adminNote = '') {
    return api.put(`/admin/after-sales/${id}/status`, {
      status,
      admin_note: adminNote
    })
  }
}

export default afterSaleAPI
