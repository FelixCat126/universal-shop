import express from 'express'
import { issueCaptcha } from '../utils/captcha.js'
import { enumerationLimiter } from '../middlewares/security.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

/**
 * 颁发滑块拼图验证码：返回 token + bg/piece SVG（data URL）等契约字段
 * 使用 enumerationLimiter 防止有人无限刷题穷举答案
 */
router.get('/captcha', enumerationLimiter, async (req, res) => {
  try {
    const data = await issueCaptcha()
    res.set('Cache-Control', 'no-store')
    res.json({ success: true, data })
  } catch (err) {
    logger.error('颁发验证码失败', { err: err?.message, stack: err?.stack })
    res.status(500).json({ success: false, message: '验证码生成失败，请稍后重试' })
  }
})

export default router
