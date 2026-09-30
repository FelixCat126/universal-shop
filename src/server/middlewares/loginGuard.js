import { LRUCache } from 'lru-cache'
import { verifyCaptcha } from '../utils/captcha.js'

/**
 * 登录失败追踪 + 验证码强制层（与 express-rate-limit 配合）
 *
 * - 限流挡住"短时间巨量请求"
 * - 本中间件挡住"低速密码爆破"：同一 IP+identity 连续失败 N 次以后必须带正确验证码
 * - 仅内存计数（适合单实例 / 入门规模），多实例需要换 Redis
 *
 * 设计取舍：登录成功只清精确键 ip::identity，不清松散键 ip::*——
 * 否则攻击者用"自己的账号登录成功"即可清零同 IP 下他人身份的失败计数，
 * 绕过验证码锁定。松散键按 TTL 自然过期；代价是共享出口（NAT）下的
 * 合法用户在 TTL 内可能仍需验证码，属可接受范围。
 *
 * 接入：
 *   1) 路由前置 requireCaptchaAfterFailures()
 *   2) 控制器密码错误时调用 recordLoginFailure(req, identity)
 *   3) 控制器登录成功后调用 clearLoginFailures(req, identity)
 */

const FAIL_WINDOW_MS = 10 * 60 * 1000
const FAIL_THRESHOLD = Number.parseInt(process.env.LOGIN_CAPTCHA_THRESHOLD || '5', 10)

const failCache = new LRUCache({
  max: 5000,
  ttl: FAIL_WINDOW_MS
})

const buildKey = (req, identity) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const id = (identity || '').toString().toLowerCase()
  return `${ip}::${id}`
}

const buildLooseKey = (req) => `${req.ip || 'unknown'}::*`

export function getFailCount (req, identity) {
  const k = buildKey(req, identity)
  const ipK = buildLooseKey(req)
  return Math.max(failCache.get(k) || 0, failCache.get(ipK) || 0)
}

export function recordLoginFailure (req, identity) {
  const k = buildKey(req, identity)
  failCache.set(k, (failCache.get(k) || 0) + 1)
  const ipK = buildLooseKey(req)
  failCache.set(ipK, (failCache.get(ipK) || 0) + 1)
}

// 只删精确键 ip::identity；松散键 ip::* 保留并按 TTL 自然过期（见顶部设计取舍）
export function clearLoginFailures (req, identity) {
  const k = buildKey(req, identity)
  failCache.delete(k)
}

/**
 * 取登录请求里的 identity（用于建 key），优先 phone，其次 email/login。
 */
const extractIdentity = (req) => {
  const b = req.body || {}
  return (
    b.phone || b.login || b.email || b.username || ''
  ).toString()
}

/**
 * 失败次数 ≥ 阈值时，要求请求带 captcha_token + captcha_answer，
 * 校验失败/缺失返回 428（Precondition Required）+ 提示需要刷新验证码。
 */
export function requireCaptchaAfterFailures () {
  return (req, res, next) => {
    const identity = extractIdentity(req)
    if (getFailCount(req, identity) < FAIL_THRESHOLD) {
      return next()
    }
    const token = req.body?.captcha_token
    const answer = req.body?.captcha_answer
    if (!token || answer === undefined) {
      return res.status(428).json({
        success: false,
        code: 'CAPTCHA_REQUIRED',
        message: '为安全起见，请先完成滑块验证码'
      })
    }
    if (!verifyCaptcha(token, answer)) {
      return res.status(428).json({
        success: false,
        code: 'CAPTCHA_INVALID',
        message: '验证码错误或已过期，请刷新重试'
      })
    }
    next()
  }
}

export const FAIL_THRESHOLD_VALUE = FAIL_THRESHOLD

/**
 * 测试用：清空内存计数器（生产无副作用）
 */
export function _resetLoginGuardForTests () {
  failCache.clear()
}
