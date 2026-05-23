import express from 'express'
import ProductController from '../controllers/productController.js'
import {
  optionalAuthenticateAdmin,
  authenticateAdmin,
  requirePermission
} from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

// 公开读：列表/详情/库存查询；optional 仍用于区分前台与管理后台行为
router.get('/', optionalAuthenticateAdmin, ProductController.getProducts)
router.post('/check-stock', ProductController.checkStock)
router.get('/:id', optionalAuthenticateAdmin, ProductController.getProduct)

// 写操作必须管理员鉴权 + products 权限（修复 P0 鉴权空洞）
router.post('/', authenticateAdmin, requirePermission('products'), ProductController.createProduct)
router.put('/:id', authenticateAdmin, requirePermission('products'), ProductController.updateProduct)
router.delete('/:id', authenticateAdmin, requirePermission('products'), ProductController.deleteProduct)
router.post('/:id/stock', authenticateAdmin, requirePermission('products'), ProductController.adjustStock)
router.post('/:id/restore', authenticateAdmin, requirePermission('products'), ProductController.restoreProduct)

export default router