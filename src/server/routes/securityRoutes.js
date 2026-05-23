import express from 'express'
import { issueCaptcha } from '../utils/captcha.js'
import { enumerationLimiter } from '../middlewares/security.js'

const router = express.Router()

/**
 * 颁发轻量验证码：返回 question + token
 * 使用 enumerationLimiter 防止有人无限刷题穷举答案
 */
router.get('/captcha', enumerationLimiter, (req, res) => {
  const data = issueCaptcha()
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, data })
})

export default router
