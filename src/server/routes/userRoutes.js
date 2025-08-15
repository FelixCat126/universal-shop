import express from 'express'
import UserController from '../controllers/userController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'

const router = express.Router()

// 公开路由（不需要认证）
router.post('/register', UserController.register)
router.post('/login', UserController.login)
router.get('/verify-referral/:code', UserController.verifyReferralCode)
router.get('/check-phone/:phone', UserController.checkPhoneExists)

// 需要认证的路由
router.get('/verify', authenticateToken, UserController.verifyToken)
router.get('/profile', authenticateToken, UserController.getCurrentUser)
router.put('/profile', authenticateToken, UserController.updateProfile)
router.post('/logout', authenticateToken, UserController.logout)

// 管理端路由（暂时不需要特殊权限验证）
router.get('/admin/users', UserController.getAllUsers)

export default router