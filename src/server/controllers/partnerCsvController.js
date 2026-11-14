/**
 * 合作方（批发客户）CSV 导入 / 导出控制器
 *
 * 薄壳：解析 HTTP、管好文件与响应格式，业务逻辑在 partnerCsvService.js。
 */
import {
  previewPartnerCsv,
  importPartnerCsv,
  exportPartnersCsv
} from '../services/partnerCsvService.js'
import { logger } from '../utils/logger.js'
import { getBusinessTimezone, localDateKey } from '../utils/businessTimezone.js'

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

export default class PartnerCsvController {
  /**
   * POST /api/admin/partners/import
   * 字段：file（CSV 文件）、dry_run（'1'/'true' 表示只预览不落库）
   */
  static async importPartners (req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: '请选择要导入的 CSV 文件' })
      }

      const dryRun = String(req.body?.dry_run ?? '1').toLowerCase() !== 'false'

      if (dryRun) {
        const preview = await previewPartnerCsv(req.file.buffer)
        return res.json({
          success: true,
          message: preview.invalidCount > 0
            ? `共 ${preview.totalRows} 行：${preview.validCount} 行可导入，${preview.invalidCount} 行有问题`
            : `共 ${preview.totalRows} 行，全部可以导入`,
          data: preview
        })
      }

      const result = await importPartnerCsv(req.file.buffer, { mode: req.body?.mode })
      logger.info('CSV 导入合作方完成', {
        created: result.createdCount,
        updated: result.updatedCount,
        failed: result.failedCount
      })
      const skippedCount = result.skipped?.length || 0
      return res.json({
        success: true,
        message: `导入完成：新建 ${result.createdCount} 个，更新 ${result.updatedCount} 个` +
          (skippedCount > 0 ? `，跳过 ${skippedCount} 行` : '') +
          (result.failed.length > 0 ? `，失败 ${result.failed.length} 行` : ''),
        data: result
      })
    } catch (e) {
      logger.error('CSV 导入合作方失败', { err: e?.message, stack: e?.stack })
      return fail(res, e, '导入失败')
    }
  }

  /**
   * GET /api/admin/partners/export.csv
   */
  static async exportPartners (req, res) {
    try {
      const csv = await exportPartnersCsv()
      // 文件名用**业务时区**的日期（原来用 toISOString = UTC 日期，
      // 凌晨导出得到的是"昨天"的文件名）
      const tz = await getBusinessTimezone()
      const filename = `partners-${localDateKey(tz, new Date())}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send(csv)
    } catch (e) {
      logger.error('导出合作方 CSV 失败', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '导出失败' })
    }
  }
}
