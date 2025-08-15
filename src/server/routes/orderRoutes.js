import express from 'express'
import OrderController from '../controllers/orderController.js'
import { authenticateToken, optionalAuth } from '../middlewares/authMiddleware.js'

const router = express.Router()

// 用户端订单路由
router.post('/', optionalAuth, OrderController.createOrder)        // 创建订单 - 支持游客模式
router.get('/', authenticateToken, OrderController.getUserOrders)       // 获取用户订单列表 - 需要认证
router.get('/:id', authenticateToken, OrderController.getOrderDetail)   // 获取订单详情 - 需要认证

export default router