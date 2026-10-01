import express from 'express'
import BundleController from '../controllers/bundleController.js'
import { cacheGet } from '../utils/responseCache.js'

const router = express.Router()

// 固定组合包公开接口（P4）：只读，无需登录
// 15s 短缓存：available_stock 由组件商品库存实时算出，缓存期间库存短暂滞后为已确认的取舍；
// 组合包写（bundleAdminController）与商品库存/上下架写（productController）都会 clearResponseCache 立即失效
router.get('/', cacheGet({ ttlMs: 15_000 }), BundleController.list)       // GET /api/bundles - active 组合包列表
router.get('/:id', cacheGet({ ttlMs: 15_000 }), BundleController.detail)  // GET /api/bundles/:id - 组合包详情

export default router
