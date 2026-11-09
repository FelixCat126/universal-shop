/**
 * 商品 CSV 导入 / 导出控制器
 *
 * 薄壳：解析 HTTP、管好文件与响应格式，业务逻辑在 productCsvService.js。
 */
import multer from 'multer'
import {
  previewProductCsv,
  importProductCsv,
  exportProductsCsv,
  MAX_CSV_BYTES
} from '../services/productCsvService.js'
import { logger } from '../utils/logger.js'
import { ApiError } from '../middlewares/errorHandler.js'
import { clearResponseCache } from '../utils/responseCache.js'

/**
 * CSV 用**内存存储**：不落盘。
 * 落盘的话，临时文件在异常路径上会残留（要另外写清理逻辑），
 * 而且导入的是"文本"，没有落盘的必要 —— 直接读进内存解析。
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    // 只认 CSV。别的类型（尤其是 xlsx）直接拒 —— 让人明确知道要另存为 CSV，
    // 而不是"上传成功但一行没导进去"
    const name = String(file.originalname || '').toLowerCase()
    const isCsv = name.endsWith('.csv') || file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/plain'
    if (!isCsv) {
      // 用 ApiError 携带 400 —— fileFilter 的错误会进全局 errorHandler，
      // 普通 Error 会被当成 500（"服务端故障"），而这其实是客户端传错文件
      cb(new ApiError('只支持 CSV 文件（请在 Excel 里另存为 CSV）', 400), false)
      return
    }
    cb(null, true)
  }
})

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

export default class ProductCsvController {
  /**
   * POST /api/admin/products/import
   * 字段：file（CSV 文件）、dry_run（'1'/'true' 表示只预览不落库）
   */
  static async importProducts (req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: '请选择要导入的 CSV 文件' })
      }

      const dryRun = String(req.body?.dry_run ?? '1').toLowerCase() !== 'false'

      if (dryRun) {
        const preview = await previewProductCsv(req.file.buffer)
        return res.json({
          success: true,
          message: preview.invalidCount > 0
            ? `共 ${preview.totalRows} 行：${preview.validCount} 行可导入，${preview.invalidCount} 行有问题`
            : `共 ${preview.totalRows} 行，全部可以导入`,
          data: preview
        })
      }

      const result = await importProductCsv(req.file.buffer)
      /**
       * 写完必须清缓存：公开的商品列表/详情有 20s 缓存，
       * 不清的话运营导完立刻去看前台还是旧商品 —— 会以为"导入没生效"。
       */
      await clearResponseCache()
      logger.info('CSV 导入商品完成', {
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
      logger.error('CSV 导入商品失败', { err: e?.message, stack: e?.stack })
      return fail(res, e, '导入失败')
    }
  }

  /**
   * GET /api/admin/products/export.csv
   * 导出当前商品（带 id，可在 Excel 里改完导回来）
   */
  static async exportProducts (req, res) {
    try {
      const csv = await exportProductsCsv()
      const filename = `products-${new Date().toISOString().slice(0, 10)}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send(csv)
    } catch (e) {
      logger.error('导出商品 CSV 失败', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '导出失败' })
    }
  }

  /** 导出处理中间件（路由层用） */
  static uploadCsv = upload.single('file')
}
