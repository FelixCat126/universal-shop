/**
 * 支付对账台账（第 51 轮）
 *
 * 超时未支付被清扫掉的订单，单据在服务端 `payment_reconciliation_records`
 * 留了完整快照（单号/金额/商品明细/地址/备注/下单人/时间）。
 * 运营在这里逐单核对"这笔钱到底收没收到"，并记录结论。
 *
 * 权限：独立的 reconciliation 资源（admin / super_admin，operator 不可见）。
 */
import api from './index.js'

export const reconciliationAPI = {
  /** 列表（按核对状态 / 订单类型 / 单号 / 被清时间筛选） */
  list (params = {}) {
    return api.get('/admin/reconciliation', { params })
  },

  /** 详情（含完整商品明细快照） */
  detail (id) {
    return api.get(`/admin/reconciliation/${id}`)
  },

  /** 标记核对结论（只改台账行，不动订单/库存） */
  update (id, payload) {
    return api.put(`/admin/reconciliation/${id}`, payload)
  }
}

export default reconciliationAPI
