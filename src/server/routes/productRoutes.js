import express from 'express'
import ProductController from '../controllers/productController.js'
import {
  optionalAuthenticateAdmin,
  authenticateAdmin,
  requirePermission
} from '../middlewares/adminAuthMiddleware.js'
import { enumerationLimiter } from '../middlewares/security.js'
import { validate, checkStockSchema } from '../middlewares/validate.js'
import { cacheGet } from '../utils/responseCache.js'

const router = express.Router()

// 公开读：列表/详情/库存查询；optional 仍用于区分前台与管理后台行为
// cacheGet 仅服务匿名前台流量（带 Authorization 的管理端请求自动旁路，不读缓存也不进缓存）；
// 管理端写（create/update/delete/restore/adjustStock）在控制器内 clearResponseCache 立即失效；
// 前台下单扣库存不主动清，公开读库存最多滞后到 TTL 结束——已确认的取舍
router.get('/', cacheGet({ ttlMs: 20_000 }), optionalAuthenticateAdmin, ProductController.getProducts)
// check-stock：公开批量查询，枚举限流 + joi 校验（productIds 1-200 个正整数），防枚举风暴
router.post('/check-stock', enumerationLimiter, validate({ body: checkStockSchema }), ProductController.checkStock)
router.get('/:id', cacheGet({ ttlMs: 15_000 }), optionalAuthenticateAdmin, ProductController.getProduct)

// 写操作必须管理员鉴权 + products 权限（修复 P0 鉴权空洞）
router.post('/', authenticateAdmin, requirePermission('products'), ProductController.createProduct)
router.put('/:id', authenticateAdmin, requirePermission('products'), ProductController.updateProduct)
router.delete('/:id', authenticateAdmin, requirePermission('products'), ProductController.deleteProduct)
router.post('/:id/stock', authenticateAdmin, requirePermission('products'), ProductController.adjustStock)
router.post('/:id/restore', authenticateAdmin, requirePermission('products'), ProductController.restoreProduct)

export default router