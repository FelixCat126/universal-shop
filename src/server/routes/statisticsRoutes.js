import express from 'express'
import StatisticsController from '../controllers/statisticsController.js'
import adminAuthMiddleware, { requirePermission } from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

// 应用管理员认证中间件
router.use(adminAuthMiddleware)

/**
 * 统计是**经营数据**（营收 / 订单 / 用户 / 活跃）。
 *
 * 之前这里只挂了认证（任何管理员都能看），没有资源级权限门 ——
 * 一旦统计口径里加入合作方/批发/毛利，operator 会**自动获得**这些数据，
 * 而"合作方数据只给 admin"是明确的设计意图。
 *
 * 现在按 orders 资源收口：admin / super_admin / operator 的现状能力**完全不变**
 * （三者的 orders 权限状态与之前一致），但多了一道纵深：
 * 将来要收紧，只需改这一处。
 */
router.get('/overview', requirePermission('orders'), StatisticsController.getOverviewStats)

// 获取七天订单趋势数据
router.get('/order-trend', requirePermission('orders'), StatisticsController.getOrderTrend)

// 获取七天用户注册趋势数据
router.get('/user-trend', requirePermission('orders'), StatisticsController.getUserRegistrationTrend)

// 获取综合统计数据
router.get('/comprehensive', requirePermission('orders'), StatisticsController.getComprehensiveStats)

export default router
