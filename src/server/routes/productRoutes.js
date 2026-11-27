import express from 'express'
import ProductController from '../controllers/productController.js'
import ProductCsvController from '../controllers/productCsvController.js'
import {
  optionalAuthenticateAdmin,
  authenticateAdmin,
  requirePermission,
  logOperation
} from '../middlewares/adminAuthMiddleware.js'
import { enumerationLimiter, writeLimiter } from '../middlewares/security.js'
import { validate, checkStockSchema } from '../middlewares/validate.js'
import { cacheGet } from '../utils/responseCache.js'

const router = express.Router()

// 公开读：列表/详情/库存查询；optional 仍用于区分前台与管理后台行为
// cacheGet 仅服务匿名前台流量（带 Authorization 的管理端请求自动旁路，不读缓存也不进缓存）；
// 管理端写（create/update/delete/restore/adjustStock）在控制器内 clearResponseCache 立即失效；
// 前台下单扣库存不主动清，公开读库存最多滞后到 TTL 结束——已确认的取舍
/**
 * 公开商品列表（第 56 轮）：
 *   - 关键词搜索**不缓存**：缓存键含 query，每个关键词占一条，
 *     搜索的人一多就把缓存写满、淘汰时把热门列表一起挤掉。
 *   - 其余情况缓存 20s（写路径会 clearResponseCache）。
 */
router.get(
  '/',
  cacheGet({
    ttlMs: 20_000,
    skipFn: (req) => String(req.query?.name || '').trim() !== ''
  }),
  optionalAuthenticateAdmin,
  ProductController.getProducts
)
// check-stock：公开批量查询，枚举限流 + joi 校验（productIds 1-200 个正整数），防枚举风暴
router.post('/check-stock', enumerationLimiter, validate({ body: checkStockSchema }), ProductController.checkStock)

/**
 * CSV 导出：**必须排在 GET /:id 之前** ——
 * 否则 "/export.csv" 会被 "/:id" 抢先匹配，id 解析失败变成 400。
 */
router.get('/export.csv', authenticateAdmin, requirePermission('products'), ProductCsvController.exportProducts)

router.get('/:id', cacheGet({ ttlMs: 15_000 }), optionalAuthenticateAdmin, ProductController.getProduct)

// 写操作必须管理员鉴权 + products 权限（修复 P0 鉴权空洞）
/**
 * 单个商品的写操作也**挂操作日志**（第 60 轮补）。
 *
 * 之前只有**批量**那条挂了 logOperation：
 *   POST /bulk → logOperation('bulk_update_product', 'product')
 * 结果是：运营改一个商品的状态/名字/价格/删除，在管理端「操作日志」里**查不到**，
 * 而批量改反而有记录 —— 恰好是"最常做的单条操作"没有留痕。
 *
 * 2026-11-27 把生产上那个名叫 "test" 的商品下架时，
 * 就是靠这条路执行的（PUT /api/products/1），
 * 结果 operation_logs 里**一条都没有** —— 谁改的、什么时候改的，查不到。
 */
router.post(
  '/',
  authenticateAdmin,
  requirePermission('products'),
  logOperation('create_product', 'product'),
  ProductController.createProduct
)
router.put(
  '/:id',
  authenticateAdmin,
  requirePermission('products'),
  logOperation('update_product', 'product'),
  ProductController.updateProduct
)
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission('products'),
  logOperation('delete_product', 'product'),
  ProductController.deleteProduct
)
// 批量操作：上下架 / 删除（一次最多 200 个）
router.post('/bulk', authenticateAdmin, requirePermission('products'), logOperation('bulk_update_product', 'product'), ProductController.bulkUpdate)
/**
 * CSV 批量导入：一次最多 500 行；默认只预览不落库（dry_run=1），
 * 运营确认预览结果后再用 dry_run=false 真正导入。
 */
router.post(
  '/import',
  authenticateAdmin,
  requirePermission('products'),
  writeLimiter,
  logOperation('import_products_csv', 'product'),
  ProductCsvController.uploadCsv,
  ProductCsvController.importProducts
)
router.post('/:id/stock', authenticateAdmin, requirePermission('products'), ProductController.adjustStock)
router.post('/:id/restore', authenticateAdmin, requirePermission('products'), ProductController.restoreProduct)

export default router