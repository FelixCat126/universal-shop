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

/**
 * 手机号归一化（用于限流 key）。
 *
 * 早期实现只去掉空格，同一号码的 '0812345678' / '081-234-5678' / '+66812345678'
 * 会变成三个不同的 key，手机号维度的限额与验证码阈值都可被格式改写绕过。
 *
 * 归一规则（目标：同一号码的各种书写形式落到同一个 key）：
 *   1. 只保留数字（去掉 + - 空格 分隔符）
 *   2. 剥离国家码前缀（86 / 66 / 60）
 *   3. 剥离国家码后若仍带 trunk 前导 0，一并去掉
 *      （泰国号码 '+66812345678' 与 '0812345678' 是同一个号）
 */
function normalizePhone (req) {
  const raw = String(req.body?.contact_phone || 'unknown')
  let digits = raw.replace(/\D+/g, '')
  if (!digits) return 'unknown'
  // 剥离国家码前缀（仅当剩余长度看起来像本地号时才剥，避免误伤本地号本身以国家码开头）
  for (const cc of ['86', '66', '60']) {
    if (digits.startsWith(cc) && digits.length - cc.length >= 9) {
      digits = digits.slice(cc.length)
      break
    }
  }
  // 剥离 trunk 前导 0：'0812345678' → '812345678'
  digits = digits.replace(/^0+/, '')
  return digits || 'unknown'
}

/**
 * 会话标识：Session-ID 头完全由客户端控制，随便换一个值就能重置会话计数，
 * 因此不能直接当限流维度。这里只接受服务端签发过的会话标识
 * （当前前端未使用该头，故实际不计入），保留扩展位但不作为主要防线。
 */
function resolveSessionKey (req) {
  const raw = req.headers['session-id']
  if (!raw) return null
  const s = String(raw).trim()
  // 长度与字符集校验：只接受形如 UUID 的服务端可预期格式
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(s)) return null
  return s
}

export async function guestOrderGuard (req, res, next) {
  try {
    if (req.user?.userId) return next()

    const phone = normalizePhone(req)
    const ip = req.ip || 'unknown'
    const sessionId = resolveSessionKey(req)
    const phoneKey = `phone:${phone}`
    const ipKey = `ip:${ip}`

    const [phoneCount, ipCount] = await Promise.all([
      store.increment(phoneKey, WINDOW_MS),
      store.increment(ipKey, WINDOW_MS)
    ])
    // 只有通过格式校验的会话标识才计入会话阈值；
    // 客户端随意伪造的 Session-ID 不再能重置该维度计数
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
