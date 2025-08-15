import express from 'express'
import SystemConfigController from '../controllers/systemConfigController.js'
import { authenticateAdmin, requireSuperAdmin, logOperation } from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

// 公开路由（无需认证）
router.get('/public', SystemConfigController.getPublicConfigs)

// 以下路由需要超级管理员权限
router.use(authenticateAdmin)
router.use(requireSuperAdmin)

// 获取所有配置
router.get('/', logOperation('view', 'system_config'), SystemConfigController.getAllConfigs)

// 设置配置
router.post('/', logOperation('update', 'system_config'), SystemConfigController.setConfig)

// 上传首页长图
router.post('/upload/home-banner', logOperation('upload', 'home_banner'), SystemConfigController.uploadHomeBanner)

// 上传支付二维码
router.post('/upload/payment-qr', logOperation('upload', 'payment_qrcode'), SystemConfigController.uploadPaymentQR)

// 删除首页长图
router.delete('/home-banner', logOperation('delete', 'home_banner'), SystemConfigController.deleteHomeBanner)

// 删除支付二维码
router.delete('/payment-qr', logOperation('delete', 'payment_qrcode'), SystemConfigController.deletePaymentQR)

// 获取单个配置
router.get('/:key', logOperation('view', 'system_config'), SystemConfigController.getConfig)

// 删除配置（通用路由，必须放在具体路由之后）
router.delete('/:key', logOperation('delete', 'system_config'), SystemConfigController.deleteConfig)

export default router
