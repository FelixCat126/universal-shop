import express from 'express'
import CouponController from '../controllers/couponController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'
import { validate, couponClaimSchema } from '../middlewares/validate.js'

const router = express.Router()

// 用户端抵扣券（P2）：全部需要登录；领取为写操作，加限流 + joi 校验
/**
 * ⚠️ 这里**不能**加全局缓存（第 49 轮差点加错）：
 * 响应里带**每个用户自己的** `claimed_by_me`（我领过几张），
 * 而缓存键只有 `方法 + 路径`（不分用户）→ A 的响应会被发给 B，
 * B 会看到"你已经领过 1 张"这种**别人的数据**。
 *
 * 要缓存只能做**按用户分键**的缓存（或把用户相关的部分挪出缓存），
 * 当前先不动 —— 这个接口本身有 LIMIT 级别的数据量，优先级低于它的正确性。
 */
router.get('/available', authenticateToken, CouponController.available)
router.post('/claim', writeLimiter, authenticateToken, validate({ body: couponClaimSchema }), CouponController.claim)
router.get('/mine', authenticateToken, CouponController.mine)

export default router
