import express from 'express'
import CouponController from '../controllers/couponController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'
import { validate, couponClaimSchema } from '../middlewares/validate.js'

const router = express.Router()

// 用户端抵扣券（P2）：全部需要登录；领取为写操作，加限流 + joi 校验
router.get('/available', authenticateToken, CouponController.available)
router.post('/claim', writeLimiter, authenticateToken, validate({ body: couponClaimSchema }), CouponController.claim)
router.get('/mine', authenticateToken, CouponController.mine)

export default router
