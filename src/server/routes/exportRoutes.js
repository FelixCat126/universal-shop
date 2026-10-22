import express from 'express'
import ExportController from '../controllers/exportController.js'
import { authenticateAdmin, requirePermission, logOperation } from '../middlewares/adminAuthMiddleware.js'
import { exportLimiter } from '../middlewares/security.js'

const router = express.Router()

// 所有导出路由都需要管理员认证 + 专项限流
router.use(authenticateAdmin, exportLimiter)

// 导出路由
router.get('/users', requirePermission('users'), logOperation('export', 'users'), ExportController.exportUsers)
router.get('/orders', requirePermission('orders'), logOperation('export', 'orders'), ExportController.exportOrders)

export default router
