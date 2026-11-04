import express from 'express'
import ExportController from '../controllers/exportController.js'
import ExportJobController from '../controllers/exportJobController.js'
import { authenticateAdmin, requirePermission, logOperation } from '../middlewares/adminAuthMiddleware.js'
import { exportLimiter } from '../middlewares/security.js'

const router = express.Router()

// 所有导出路由都需要管理员认证
router.use(authenticateAdmin)

// 异步导出任务：提交后立即返回 jobId，文件后台生成
//
// 限流说明：exportLimiter（10 次/分）只加在「会消耗服务器资源」的写操作上，
// 不能加在列表查询上 —— 前端会每 3 秒轮询任务状态，
// 若列表也限流，正常的轮询会直接被 429 打断。
router.post('/jobs', exportLimiter, logOperation('export_job_create', 'export'), ExportJobController.createJob)
router.get('/jobs', ExportJobController.listJobs)
router.get('/jobs/:id/download', exportLimiter, ExportJobController.downloadJob)
router.delete('/jobs/:id', exportLimiter, ExportJobController.deleteJob)

// 同步导出（保留：小数据量时更方便，浏览器直接下载）
router.get('/users', requirePermission('users'), exportLimiter, logOperation('export', 'users'), ExportController.exportUsers)
router.get('/orders', requirePermission('orders'), exportLimiter, logOperation('export', 'orders'), ExportController.exportOrders)

export default router
