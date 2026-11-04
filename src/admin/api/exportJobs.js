import api from './index.js'

/**
 * 异步导出任务 API
 *
 * 与同步导出（/admin/export/users、/admin/export/orders）的区别：
 *   同步：请求内生成并下载，数据量大时长时间占用连接、可能超时
 *   异步：提交任务 → 后台生成 → 列表里下载，不阻塞、管理员可继续操作
 */

// 提交导出任务（type: 'users' | 'orders'）
export const createExportJob = (type, params = {}) => {
  return api.post('/admin/export/jobs', { type, ...params })
}

// 任务列表（后端只返回当前管理员自己的任务）
export const listExportJobs = () => {
  return api.get('/admin/export/jobs')
}

// 删除任务
export const deleteExportJob = (id) => {
  return api.delete(`/admin/export/jobs/${id}`)
}

// 下载已完成的文件（blob）
export const downloadExportJob = (id) => {
  return api.get(`/admin/export/jobs/${id}/download`, { responseType: 'blob' })
}

/**
 * 从响应头里取文件名（后端用 RFC 5987 的 filename*=UTF-8'' 编码中文名）
 */
export const parseDownloadFilename = (headers, fallback = 'export.xlsx') => {
  const disposition = headers?.['content-disposition'] || headers?.['Content-Disposition']
  if (!disposition) return fallback
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)
  return plain ? plain[1] : fallback
}

export default {
  createExportJob,
  listExportJobs,
  deleteExportJob,
  downloadExportJob,
  parseDownloadFilename
}
