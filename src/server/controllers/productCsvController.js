/**
 * 商品 CSV 导入 / 导出控制器
 *
 * 薄壳：解析 HTTP、管好文件与响应格式，业务逻辑在 productCsvService.js。
 */
import multer from 'multer'
import {
  previewProductCsv,
  importProductCsv,
  streamProductsCsv,
  MAX_CSV_BYTES
} from '../services/productCsvService.js'
import { logger } from '../utils/logger.js'
import { buildProductListWhere } from './productController.js'
import { ApiError } from '../middlewares/errorHandler.js'
import { clearResponseCache } from '../utils/responseCache.js'
import { getBusinessTimezone, localDateKey } from '../utils/businessTimezone.js'

/**
 * CSV 用**内存存储**：不落盘。
 * 落盘的话，临时文件在异常路径上会残留（要另外写清理逻辑），
 * 而且导入的是"文本"，没有落盘的必要 —— 直接读进内存解析。
 *
 * 内存存储有个硬上限（MAX_CSV_BYTES），超出 multer 自己会返回 413/400 ——
 * 这正是我们要的：不让一个误传的大文件把内存吃满。
 */
export const csvUpload = multer({
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

      const result = await importProductCsv(req.file.buffer, { mode: req.body?.mode })
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
      const skippedCount = result.skipped?.length || 0
      return res.json({
        success: true,
        message: `导入完成：新建 ${result.createdCount} 个，更新 ${result.updatedCount} 个` +
          (skippedCount > 0 ? `，跳过 ${skippedCount} 行` : '') +
          (result.failed.length > 0 ? `，失败 ${result.failed.length} 行` : ''),
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
      /**
       * 流式导出（第 57 轮）：一批一批吐，内存占用与总量无关。
       * 客户端中途断开（res.close）要**停下来** —— 不然会白跑一遍全表查询。
       */
      const tz = await getBusinessTimezone()
      const filename = `products-${localDateKey(tz, new Date())}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

      /**
       * 导出**按当前筛选条件**（第 63 轮）。
       *
       * 之前导出**完全不看筛选**，永远给全部商品 —— 于是：
       *   运营筛出「缺泰文名的 17 个」→ 点导出 → 拿到 18 条全部商品
       *   → 他得自己删行才能当"待补清单"用。
       *
       * 现在与列表**同一套口径**（buildProductListWhere）：
       * "筛出待补 → 导出 → 在 Excel 里补 name_th/描述 → 从导入 CSV 导回（带 id = 更新）"
       * 这条闭环这才走得通。
       */
      const where = buildProductListWhere(req.query, { isAdmin: true })

      let closed = false
      res.on('close', () => { closed = true })

      // paranoid: false —— 与管理端列表**同一口径**（列表能看到已下架的商品，
      // 导出也就要能看到，否则"导出 == 列表"这句话是假的）
      for await (const chunk of streamProductsCsv({ shouldStop: () => closed, where, paranoid: false })) {
        if (closed) break
        res.write(chunk)
      }
      if (!closed) res.end()
      return
    } catch (error) {
      logger.error('导出商品 CSV 失败', { err: error?.message, stack: error?.stack })
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: '导出失败' })
      }
      return res.end()
    }
  }

  /** 导出处理中间件（路由层用） */
  static uploadCsv = csvUpload.single('file')
}
