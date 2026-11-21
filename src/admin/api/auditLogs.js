/**
 * 行为审计日志（第 46 轮）
 *
 * 与「操作日志」（OperationLog，管理员在后台的写操作）不同：
 * 这里查的是 **AuditLog** —— 用户与合作方的行为（登录、下单、改密、取消…）。
 *
 * 之前 AuditLog 只写不读 → 合作方的行为在运营界面完全无痕
 * （合作方说"我没下过这单"，运营查不出来）。
 */
import api from './index.js'

export const auditLogAPI = {
  /** 列表（可按主体类型/事件/资源/日期筛选；分页参数名与操作日志一致） */
  list (params = {}) {
    return api.get('/admin/audit-logs', { params })
  }
}

export default auditLogAPI
