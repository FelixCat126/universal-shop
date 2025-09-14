import express from 'express'
import OrderController from '../controllers/orderController.js'
import UserController from '../controllers/userController.js'
import AdministratorController from '../controllers/administratorController.js'
import AddressController from '../controllers/addressController.js'
import { authenticateAdmin, requirePermission, requireSuperAdmin, logOperation } from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

// 管理员登录（无需认证）
router.post('/login', AdministratorController.login)

// 初始化超级管理员（无需认证，仅在没有管理员时可用）
router.post('/init', AdministratorController.initSuperAdmin)

// 验证token（需要认证）
router.get('/validate-token', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Token有效',
    data: {
      admin: req.admin
    }
  })
})

// 以下路由需要管理员认证
router.use(authenticateAdmin)

// 管理员订单路由（需要orders权限）
router.get('/orders', requirePermission('orders'), OrderController.getAllOrders)
router.get('/orders/:id', requirePermission('orders'), OrderController.getOrderDetail)
router.put('/orders/:id/status', requirePermission('orders'), logOperation('update_order_status', 'order'), OrderController.updateOrderStatus)
router.delete('/orders/:id', requirePermission('orders'), logOperation('delete_order', 'order'), OrderController.deleteOrder)
router.get('/orders/export', requirePermission('orders'), OrderController.exportOrders)

// 管理员用户路由（需要users权限）
router.get('/users', requirePermission('users'), UserController.getAllUsers)
router.put('/users/:id/status', requirePermission('users'), logOperation('update_user_status', 'user'), UserController.updateUserStatus)
router.get('/users/:userId/addresses', requirePermission('users'), AddressController.getAdminUserAddresses)

// 管理员管理路由（需要administrators权限）
router.get('/administrators', requirePermission('administrators'), AdministratorController.getAllAdministrators)
router.post('/administrators', requirePermission('administrators'), logOperation('create_administrator', 'administrator'), AdministratorController.createAdministrator)
router.put('/administrators/:id', requirePermission('administrators'), logOperation('update_administrator', 'administrator'), AdministratorController.updateAdministrator)
router.delete('/administrators/:id', requirePermission('administrators'), logOperation('delete_administrator', 'administrator'), AdministratorController.deleteAdministrator)
router.put('/administrators/:id/reset-password', requirePermission('administrators'), logOperation('reset_password', 'administrator'), AdministratorController.resetPassword)

// 操作日志路由（仅超级管理员）
router.get('/operation-logs', requireSuperAdmin, AdministratorController.getOperationLogs)

export default router
