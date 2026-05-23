import express from 'express'
import UserController from '../controllers/userController.js'
import PointsController from '../controllers/pointsController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { loginLimiter, enumerationLimiter, writeLimiter } from '../middlewares/security.js'
import { validate, registerSchema, loginSchema } from '../middlewares/validate.js'
import { requireCaptchaAfterFailures } from '../middlewares/loginGuard.js'

const router = express.Router()

// 公开路由（不需要认证）：加挂限流 + joi 校验
router.post('/register', writeLimiter, validate({ body: registerSchema }), UserController.register)
// /login: 限流 → 失败次数过阈值时强制验证码 → joi 校验业务字段
router.post(
  '/login',
  loginLimiter,
  requireCaptchaAfterFailures(),
  validate({ body: loginSchema }),
  UserController.login
)
router.get('/verify-referral/:code', enumerationLimiter, UserController.verifyReferralCode)
router.get('/check-phone/:phone', enumerationLimiter, UserController.checkPhoneExists)

// 需要认证的路由
router.get('/verify', authenticateToken, UserController.verifyToken)
router.get('/profile/metrics', authenticateToken, UserController.getProfileMetrics)
router.get('/profile', authenticateToken, UserController.getCurrentUser)
router.put('/profile', authenticateToken, UserController.updateProfile)
router.put('/profile/password', authenticateToken, UserController.changePassword)
router.post('/logout', authenticateToken, UserController.logout)
router.get('/points/balance', authenticateToken, PointsController.getBalance)
router.get('/points/transactions', authenticateToken, PointsController.listTransactions)

// 注意：旧 GET /admin/users 未鉴权且与 /api/admin/users 重复，已下线（修复 P0 拖库空洞）。
// 管理端请改用 /api/admin/users（adminRoutes.js）。

export default router