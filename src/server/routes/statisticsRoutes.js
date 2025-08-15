import express from 'express'
import StatisticsController from '../controllers/statisticsController.js'
import adminAuthMiddleware from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

// 应用管理员认证中间件
router.use(adminAuthMiddleware)

// 获取统计总览数据
router.get('/overview', StatisticsController.getOverviewStats)

// 获取七天订单趋势数据
router.get('/order-trend', StatisticsController.getOrderTrend)

// 获取七天用户注册趋势数据
router.get('/user-trend', StatisticsController.getUserRegistrationTrend)

// 获取综合统计数据
router.get('/comprehensive', StatisticsController.getComprehensiveStats)

export default router
