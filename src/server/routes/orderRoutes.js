import express from 'express'
import OrderController from '../controllers/orderController.js'
import { authenticateToken, optionalAuth } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'
import { validate, createOrderSchema } from '../middlewares/validate.js'

const router = express.Router()

// 用户端订单路由：写操作限流 + joi 校验
router.post('/', writeLimiter, optionalAuth, validate({ body: createOrderSchema }), OrderController.createOrder)
router.get('/', authenticateToken, OrderController.getUserOrders)
router.post('/:id/confirm-online-payment', writeLimiter, authenticateToken, OrderController.confirmOnlinePayment)
router.get('/:id', authenticateToken, OrderController.getOrderDetail)

export default router