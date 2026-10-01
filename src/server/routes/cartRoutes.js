import express from 'express'
import CartController from '../controllers/cartController.js'
import { optionalAuth } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'

const router = express.Router()

// 购物车路由 - 使用可选认证中间件；写端点挂 writeLimiter（游客 Session-ID 可伪造，防垃圾行污染，测试环境 no-op）
router.get('/', optionalAuth, CartController.getCart)                            // GET /api/cart - 获取购物车
router.post('/', writeLimiter, optionalAuth, CartController.addToCart)           // POST /api/cart - 添加到购物车
router.put('/:id', writeLimiter, optionalAuth, CartController.updateCartItem)    // PUT /api/cart/:id - 更新购物车项目
router.delete('/:id', writeLimiter, optionalAuth, CartController.removeFromCart) // DELETE /api/cart/:id - 删除购物车项目
router.delete('/', writeLimiter, optionalAuth, CartController.clearCart)         // DELETE /api/cart - 清空购物车

export default router