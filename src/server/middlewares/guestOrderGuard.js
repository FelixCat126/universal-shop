import { createSharedStore } from '../utils/sharedState.js'
import { verifyCaptcha } from '../utils/captcha.js'

/**
 * 游客下单反滥用：IP + 手机号 + Session 多维计数。
 * 超过阈值后强制滑块验证码；超过硬上限直接 429。
 * 配置 REDIS_URL 后计数跨实例共享。
 */

const store = createSharedStore('guest-order-guard')

let captchaThreshold = Number(process.env.GUEST_ORDER_CAPTCHA_THRESHOLD || 3)
let maxPerHour = Number(process.env.GUEST_ORDER_MAX_PER_HOUR || 20)
let maxPerIpPerHour = Number(process.env.GUEST_ORDER_MAX_IP_PER_HOUR || 100)
const WINDOW_MS = 60 * 60 * 1000

function normalizePhone (req) {
  return String(req.body?.contact_phone || 'unknown').replace(/\s+/g, '')
}

export async function guestOrderGuard (req, res, next) {
  try {
    if (req.user?.userId) return next()

    const phone = normalizePhone(req)
    const ip = req.ip || 'unknown'
    const sessionId = req.headers['session-id']
    const phoneKey = `phone:${phone}`
    const ipKey = `ip:${ip}`

    const [phoneCount, ipCount] = await Promise.all([
      store.increment(phoneKey, WINDOW_MS),
      store.increment(ipKey, WINDOW_MS)
    ])
    // 只有真实带 Session-ID 的匿名购物车才计入会话阈值；
    // 不能把 'anonymous' 当成共享会话，否则不同游客会互相触发验证码
    const sessionCount = sessionId
      ? await store.increment(`session:${sessionId}`, WINDOW_MS)
      : 0

    if (phoneCount > maxPerHour || ipCount > maxPerIpPerHour) {
      return res.status(429).json({
        success: false,
        code: 'GUEST_ORDER_RATE_LIMITED',
        message: '当前手机号或 IP 下单过于频繁，请稍后再试'
      })
    }

    if (phoneCount >= captchaThreshold || sessionCount >= captchaThreshold) {
      const token = req.body?.captcha_token
      const answer = req.body?.captcha_answer
      if (!token || answer === undefined) {
        return res.status(428).json({
          success: false,
          code: 'CAPTCHA_REQUIRED',
          message: '为安全起见，请先完成滑块验证码后再下单'
        })
      }
      const valid = await verifyCaptcha(token, answer)
      if (!valid) {
        return res.status(428).json({
          success: false,
          code: 'CAPTCHA_INVALID',
          message: '验证码错误或已过期，请刷新后重试'
        })
      }
    }
    return next()
  } catch (err) {
    return next(err)
  }
}

export function _resetGuestOrderProtectionForTests () {
  return store.clear()
}

export function _setGuestOrderProtectionForTests ({ threshold, phoneLimit, ipLimit } = {}) {
  if (threshold != null) captchaThreshold = threshold
  if (phoneLimit != null) maxPerHour = phoneLimit
  if (ipLimit != null) maxPerIpPerHour = ipLimit
}

export function _getGuestOrderProtectionConfigForTests () {
  return { captchaThreshold, maxPerHour, maxPerIpPerHour }
}
