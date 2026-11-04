import fs from 'fs'
import { Op } from 'sequelize'
import ExportJob from '../models/ExportJob.js'
import {
  createExportJob,
  cleanupExportJobs,
  cleanupExpiredExportFiles,
  triggerExportJobs
} from '../services/exportJobService.js'
import { logger } from '../utils/logger.js'
import { hasPermissionByRole } from '../models/Administrator.js'

/**
 * 管理员权限判定：复用模型导出的唯一权威权限表（避免多处各写一份导致漂移）。
 * req.admin 是中间件构造的普通对象，没有模型实例的 hasPermission 方法，
 * 因此用按角色的判定函数。
 */
function adminHasPermission (admin, resource) {
  if (!admin?.role) return false
  return hasPermissionByRole(admin.role, resource)
}

/**
 * 异步导出任务控制器
 *
 * 与同步导出（ExportController）的分工：
 *   同步：请求内完成，浏览器直接收到文件；适合万级以内
 *   异步：提交任务 → 后台生成 → 列表里下载；适合十万级以上，不阻塞请求
 */
class ExportJobController {
  /** 创建导出任务 */
  static async createJob (req, res) {
    try {
      const { type } = req.body || {}
      const allowed = { users: 'users', orders: 'orders' }
      const normalized = allowed[type]
      if (!normalized) {
        return res.status(400).json({
          success: false,
          message: '不支持的导出类型（可选：users / orders）',
          code: 'INVALID_EXPORT_TYPE'
        })
      }
      // 权限校验：导出的数据范围必须与管理员权限一致。
      // req.admin 上没有权限判定函数（那是模型实例的方法），
      // 这里按角色查权限表，与 requirePermission 中间件同一口径。
      const perm = normalized === 'users' ? 'users' : 'orders'
      if (!adminHasPermission(req.admin, perm)) {
        return res.status(403).json({
          success: false,
          message: '权限不足，无法导出该类型数据',
          code: 'FORBIDDEN'
        })
      }

      const params = sanitizeParams(req.body)

      // 同一管理员、同类型、**同筛选条件**的任务已在跑时不重复提交。
      // 筛选条件不同则必须新建 —— 否则管理员改了筛选再点导出，
      // 拿到的却是上一个筛选条件的结果，且界面上看不出差别。
      const existing = await ExportJob.findOne({
        where: {
          admin_id: req.admin.id,
          type: normalized,
          status: { [Op.in]: ['pending', 'running'] }
        },
        order: [['id', 'DESC']]
      })
      if (existing && sameParams(existing.params, params)) {
        return res.status(200).json({
          success: true,
          message: '已有相同条件的导出任务在进行中',
          data: { job: formatJob(existing), reused: true }
        })
      }

      const job = await createExportJob({
        adminId: req.admin.id,
        adminUsername: req.admin.username,
        type: normalized,
        params
      })
      // 立刻触发一次后台处理，避免管理员等满一个轮询周期才看到进度
      triggerExportJobs()
      return res.status(201).json({
        success: true,
        message: '导出任务已提交，完成后可在列表中下载',
        data: { job: formatJob(job), reused: false }
      })
    } catch (error) {
      logger.error('创建导出任务失败', { err: error?.message, stack: error?.stack })
      return res.status(error?.status || 500).json({
        success: false,
        message: error?.message || '创建导出任务失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  /** 任务列表（只返回自己的任务） */
  static async listJobs (req, res) {
    try {
      const rows = await ExportJob.findAll({
        where: { admin_id: req.admin.id },
        order: [['id', 'DESC']],
        limit: 50
      })
      return res.json({
        success: true,
        data: { jobs: rows.map(formatJob) }
      })
    } catch (error) {
      logger.error('读取导出任务列表失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '读取导出任务列表失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  /** 下载已完成的文件 */
  static async downloadJob (req, res) {
    try {
      const id = Number.parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的任务 ID' })
      }
      const job = await ExportJob.findByPk(id)
      if (!job) {
        return res.status(404).json({ success: false, message: '导出任务不存在' })
      }
      // 归属校验放在状态校验之前：越权请求应返回 403，
      // 否则会因「任务未完成」先返回 409，掩盖越权事实
      if (job.admin_id !== req.admin.id && !adminHasPermission(req.admin, '*')) {
        return res.status(403).json({ success: false, message: '无权下载该导出文件' })
      }
      // 类型权限复核：管理员角色可能在建任务后被降级，
      // 此时不应还能下载该类型数据
      const perm = job.type === 'users' ? 'users' : job.type === 'orders' ? 'orders' : null
      if (perm && !adminHasPermission(req.admin, perm)) {
        return res.status(403).json({
          success: false,
          message: '权限不足，无法下载该类型数据',
          code: 'FORBIDDEN'
        })
      }
      if (job.status !== 'done' || !job.file_path) {
        return res.status(409).json({
          success: false,
          message: job.status === 'failed'
            ? `导出失败：${job.error_message || '未知原因'}`
            : '导出尚未完成',
          code: 'EXPORT_NOT_READY'
        })
      }
      // 文件可能已被 TTL 清理
      if (!fs.existsSync(job.file_path)) {
        return res.status(410).json({
          success: false,
          message: '导出文件已过期，请重新导出',
          code: 'EXPORT_FILE_EXPIRED'
        })
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(job.file_name || 'export.xlsx')}`
      )
      const stream = fs.createReadStream(job.file_path)
      stream.on('error', (err) => {
        // 文件可能在下载途中被 TTL 清理删掉；此时不能崩进程
        logger.warn('导出文件读取失败', { jobId: job.id, err: err?.message })
        if (!res.headersSent) {
          res.status(404).json({ success: false, message: '导出文件不存在' })
        } else {
          res.destroy()
        }
      })
      stream.pipe(res)
    } catch (error) {
      logger.error('下载导出文件失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '下载导出文件失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  /** 删除任务（并清理文件） */
  static async deleteJob (req, res) {
    try {
      const id = Number.parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的任务 ID' })
      }
      const job = await ExportJob.findByPk(id)
      if (!job) {
        return res.status(404).json({ success: false, message: '导出任务不存在' })
      }
      if (job.admin_id !== req.admin.id && !adminHasPermission(req.admin, '*')) {
        return res.status(403).json({ success: false, message: '无权操作该任务' })
      }
      // 进行中的任务不允许删（避免与 worker 竞争写文件）
      if (job.status === 'running' || job.status === 'pending') {
        return res.status(409).json({ success: false, message: '任务进行中，无法删除' })
      }
      if (job.file_path) {
        await fs.unlink(job.file_path).catch(() => {})
      }
      await job.destroy()
      return res.json({ success: true, message: '已删除' })
    } catch (error) {
      logger.error('删除导出任务失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '删除导出任务失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  /** 手动触发清理（运维用：清旧任务与过期文件） */
  static async cleanup (req, res) {
    try {
      const jobs = await cleanupExportJobs({ keepDays: 7 })
      const files = await cleanupExpiredExportFiles()
      return res.json({ success: true, data: { ...jobs, filesRemoved: files } })
    } catch (error) {
      logger.error('清理导出任务失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '清理失败' })
    }
  }
}

/** 任务对象格式化（不暴露磁盘绝对路径） */
function formatJob (job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    row_count: job.row_count,
    file_name: job.file_name,
    file_size: job.file_size,
    error_message: job.error_message,
    // 筛选条件：管理员要能看出「这个文件是哪一批数据」
    params: job.params && typeof job.params === 'object' ? job.params : {},
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    downloadable: job.status === 'done' && Boolean(job.file_path)
  }
}

/** 比较两组筛选参数是否等价（键序无关） */
function sameParams (a = {}, b = {}) {
  const ka = Object.keys(a || {}).sort()
  const kb = Object.keys(b || {}).sort()
  if (ka.length !== kb.length) return false
  return ka.every((k, i) => k === kb[i] && String(a[k]) === String(b[k]))
}

/** 过滤提交参数，只保留白名单（防止把任意字段塞进 params 传给导出层） */
function sanitizeParams (body = {}) {
  const allowed = [
    'status', 'keyword', 'email', 'phone', 'referral_code',
    'startDate', 'endDate', 'from', 'to'
  ]
  const out = {}
  for (const k of allowed) {
    const v = body[k]
    if (v === undefined || v === null) continue
    // 日期控件给的是 Date 对象，统一转 ISO 字符串（与列表接口口径一致）
    if (v instanceof Date) {
      if (!Number.isNaN(v.getTime())) out[k] = v.toISOString()
      continue
    }
    // 全部按字符串处理并限长，避免超长输入打到 LIKE 上
    if (typeof v === 'string' || typeof v === 'number') {
      const str = String(v).slice(0, 100)
      if (str !== '') out[k] = str
    }
  }
  return out
}

export default ExportJobController
