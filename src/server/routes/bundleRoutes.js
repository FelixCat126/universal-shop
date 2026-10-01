import express from 'express'
import BundleController from '../controllers/bundleController.js'

const router = express.Router()

// 固定组合包公开接口（P4）：只读，无需登录
router.get('/', BundleController.list)       // GET /api/bundles - active 组合包列表
router.get('/:id', BundleController.detail)  // GET /api/bundles/:id - 组合包详情

export default router
