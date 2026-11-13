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
/**
 * 异步导出任务：路由层加一道**最低门槛**（orders 权限）。
 *
 * 精确的类型权限（users / orders / partners / products）由控制器按 type 判
 * （EXPORT_TYPE_PERMISSION），但那里只有**一层** ——
 * 上一轮修的正是"合作方数据被判成 orders"这个位置。
 * 只要有任何新路径绕过控制器（新增 type、后台任务直调 service），
 * 同样的越权就会原样复发。
 *
 * 所以路由层也补一道：现有角色能力**完全不变**
 * （super_admin 有 *、admin/operator 都有 orders），
 * 但多了一层纵深 —— 控制器失守时这里还能挡住。
 */
router.post('/jobs', requirePermission('orders'), exportLimiter, logOperation('export_job_create', 'export'), ExportJobController.createJob)
router.get('/jobs', requirePermission('orders'), ExportJobController.listJobs)
router.get('/jobs/:id/download', requirePermission('orders'), exportLimiter, ExportJobController.downloadJob)
router.delete('/jobs/:id', requirePermission('orders'), exportLimiter, ExportJobController.deleteJob)

// 同步导出（保留：小数据量时更方便，浏览器直接下载）
router.get('/users', requirePermission('users'), exportLimiter, logOperation('export', 'users'), ExportController.exportUsers)
router.get('/orders', requirePermission('orders'), exportLimiter, logOperation('export', 'orders'), ExportController.exportOrders)

export default router
