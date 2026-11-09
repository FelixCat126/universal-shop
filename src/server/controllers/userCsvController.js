/**
 * 用户 CSV 导入 / 导出控制器
 *
 * 薄壳：解析 HTTP、管好文件与响应格式，业务逻辑在 userCsvService.js。
 */
import {
  previewUserCsv,
  importUserCsv,
  exportUsersCsv
} from '../services/userCsvService.js'
import { logger } from '../utils/logger.js'

/** 统一的错误响应 */
function fail (res, error, fallback) {
  const status = error?.status || 500
  const body = {
    success: false,
    message: error?.message || fallback
  }
  if (error?.preview) body.data = error.preview
  return res.status(status).json(body)
}

export default class UserCsvController {
  /**
   * POST /api/admin/users/import
   * 字段：file（CSV 文件）、dry_run（'1'/'true' 表示只预览不落库）
   */
  static async importUsers (req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: '请选择要导入的 CSV 文件' })
      }

      const dryRun = String(req.body?.dry_run ?? '1').toLowerCase() !== 'false'

      if (dryRun) {
        const preview = await previewUserCsv(req.file.buffer)
        return res.json({
          success: true,
          message: preview.invalidCount > 0
            ? `共 ${preview.totalRows} 行：${preview.validCount} 行可导入，${preview.invalidCount} 行有问题`
            : `共 ${preview.totalRows} 行，全部可以导入`,
          data: preview
        })
      }

      const result = await importUserCsv(req.file.buffer)
      logger.info('CSV 导入用户完成', {
        created: result.createdCount,
        updated: result.updatedCount,
        failed: result.failedCount
      })
      return res.json({
        success: true,
        message: `导入完成：新建 ${result.createdCount} 个，更新 ${result.updatedCount} 个` +
          (result.failedCount > 0 ? `，失败 ${result.failedCount} 个` : ''),
        data: result
      })
    } catch (e) {
      logger.error('CSV 导入用户失败', { err: e?.message, stack: e?.stack })
      return fail(res, e, '导入失败')
    }
  }

  /**
   * GET /api/admin/users/export.csv
   */
  static async exportUsers (req, res) {
    try {
      const csv = await exportUsersCsv()
      const filename = `users-${new Date().toISOString().slice(0, 10)}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send(csv)
    } catch (e) {
      logger.error('导出用户 CSV 失败', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '导出失败' })
    }
  }
}
