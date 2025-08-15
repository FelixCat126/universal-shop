import express from 'express'
import ProductController from '../controllers/productController.js'

const router = express.Router()

// 产品路由
router.get('/', ProductController.getProducts)           // 获取产品列表
router.get('/:id', ProductController.getProduct)        // 获取单个产品
router.post('/', ProductController.createProduct)       // 创建产品
router.put('/:id', ProductController.updateProduct)     // 更新产品
router.delete('/:id', ProductController.deleteProduct)  // 删除产品
router.post('/:id/stock', ProductController.adjustStock) // 调整库存
router.post('/check-stock', ProductController.checkStock) // 批量检查库存

export default router