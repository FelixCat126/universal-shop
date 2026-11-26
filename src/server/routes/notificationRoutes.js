import express from 'express'
import NotificationController from '../controllers/notificationController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'

const router = express.Router()

/**
 * 站内通知（第 54 轮）
 * =====================
 *
 * 用户在这里看到"我的订单发货了""售后被驳回了""积分到账了"。
 *
 * 全部需要登录（通知是**个人**的）。
 * `requirePasswordChange` 不加：强制改密状态下也应该能看通知
 * （用户还没改密就看不到"为什么被要求改密"，反而困惑）。
 */
router.get('/', authenticateToken, NotificationController.list)
router.get('/unread-count', authenticateToken, NotificationController.unreadCount)
router.put('/read-all', writeLimiter, authenticateToken, NotificationController.markAllRead)
router.put('/:id/read', writeLimiter, authenticateToken, NotificationController.markRead)

export default router
