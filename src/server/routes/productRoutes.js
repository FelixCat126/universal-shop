import express from 'express'
import ProductController from '../controllers/productController.js'
import { optionalAuthenticateAdmin } from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

router.use(optionalAuthenticateAdmin)

// 产品路由（带管理员 token 时包含已下架商品并可恢复）
router.get('/', ProductController.getProducts)           // 获取产品列表
router.post('/check-stock', ProductController.checkStock) // 须在 /:id 之前
router.post('/:id/restore', ProductController.restoreProduct) // 重新上架（清除软删除）
router.get('/:id', ProductController.getProduct)        // 获取单个产品
router.post('/', ProductController.createProduct)       // 创建产品
router.put('/:id', ProductController.updateProduct)     // 更新产品
router.delete('/:id', ProductController.deleteProduct)  // 下架产品（逻辑删除）
router.post('/:id/stock', ProductController.adjustStock) // 调整库存

export default router