import express from 'express'
import OrderController from '../controllers/orderController.js'
import { authenticateToken, optionalAuth } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'
import { guestOrderGuard } from '../middlewares/guestOrderGuard.js'
import { validate, createOrderSchema, quoteOrderSchema } from '../middlewares/validate.js'
import AfterSaleController from '../controllers/afterSaleController.js'

const router = express.Router()

// 用户端订单路由：写操作限流 + joi 校验
router.post('/', writeLimiter, optionalAuth, guestOrderGuard, validate({ body: createOrderSchema }), OrderController.createOrder)
// 订单试算（只算价不落库）：与 createOrder 共用计价引擎，供结算页预展示
router.post('/quote', writeLimiter, optionalAuth, validate({ body: quoteOrderSchema }), OrderController.quoteOrder)
router.get('/after-sales/mine', authenticateToken, AfterSaleController.listMine)
router.post('/:id/after-sales', writeLimiter, authenticateToken, AfterSaleController.create)
router.get('/', authenticateToken, OrderController.getUserOrders)
router.post('/:id/confirm-online-payment', writeLimiter, authenticateToken, OrderController.confirmOnlinePayment)
// 用户自助取消订单（第 45 轮）：让「取消 → 积分退回 / 券退还」这条链有客户的入口
router.post('/:id/cancel', writeLimiter, authenticateToken, OrderController.cancelOrder)
// 客户修改订单备注（第 46 轮）：之前只能在结算页下单时填，下单后改不了
router.put('/:id/notes', writeLimiter, authenticateToken, OrderController.updateOrderNotes)
router.get('/:id', authenticateToken, OrderController.getOrderDetail)

export default router