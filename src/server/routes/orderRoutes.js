import express from 'express'
import OrderController from '../controllers/orderController.js'
import { authenticateToken, optionalAuth } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'
import { validate, createOrderSchema, quoteOrderSchema } from '../middlewares/validate.js'

const router = express.Router()

// 用户端订单路由：写操作限流 + joi 校验
router.post('/', writeLimiter, optionalAuth, validate({ body: createOrderSchema }), OrderController.createOrder)
// 订单试算（只算价不落库）：与 createOrder 共用计价引擎，供结算页预展示
router.post('/quote', writeLimiter, optionalAuth, validate({ body: quoteOrderSchema }), OrderController.quoteOrder)
router.get('/', authenticateToken, OrderController.getUserOrders)
router.post('/:id/confirm-online-payment', writeLimiter, authenticateToken, OrderController.confirmOnlinePayment)
router.get('/:id', authenticateToken, OrderController.getOrderDetail)

export default router