import { createSharedStore } from '../utils/sharedState.js'
import { verifyCaptcha } from '../utils/captcha.js'

/**
 * 登录失败追踪 + 验证码强制层（与 express-rate-limit 配合）
 *
 * - 限流挡住"短时间巨量请求"
 * - 本中间件挡住"低速密码爆破"：同一 IP+identity 连续失败 N 次以后必须带正确验证码
 * - 配置 REDIS_URL 后计数跨实例共享；未配置时使用单实例内存实现
 *
 * 设计取舍：登录成功只清精确键 ip::identity，不清松散键 ip::*——
 * 否则攻击者用"自己的账号登录成功"即可清零同 IP 下他人身份的失败计数，
 * 绕过验证码锁定。松散键按 TTL 自然过期；代价是共享出口（NAT）下的
 * 合法用户在 TTL 内可能仍需验证码，属可接受范围。
 */

const FAIL_WINDOW_MS = 10 * 60 * 1000
const FAIL_THRESHOLD = Number.parseInt(process.env.LOGIN_CAPTCHA_THRESHOLD || '5', 10)

const failCache = createSharedStore('login-fail')

const buildKey = (req, identity) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const id = (identity || '').toString().toLowerCase()
  return `${ip}::${id}`
}

const buildLooseKey = (req) => `${req.ip || 'unknown'}::*`

export async function getFailCount (req, identity) {
  const k = buildKey(req, identity)
  const ipK = buildLooseKey(req)
  const [exact, loose] = await Promise.all([
    failCache.get(k),
    failCache.get(ipK)
  ])
  return Math.max(Number(exact) || 0, Number(loose) || 0)
}

export async function recordLoginFailure (req, identity) {
  const k = buildKey(req, identity)
  const ipK = buildLooseKey(req)
  await Promise.all([
    failCache.increment(k, FAIL_WINDOW_MS),
    failCache.increment(ipK, FAIL_WINDOW_MS)
  ])
}

// 只删精确键 ip::identity；松散键 ip::* 保留并按 TTL 自然过期（见顶部设计取舍）
export async function clearLoginFailures (req, identity) {
  const k = buildKey(req, identity)
  await failCache.delete(k)
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
  return async (req, res, next) => {
    try {
      const identity = extractIdentity(req)
      const failCount = await getFailCount(req, identity)
      if (failCount < FAIL_THRESHOLD) {
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
      const valid = await verifyCaptcha(token, answer)
      if (!valid) {
        return res.status(428).json({
          success: false,
          code: 'CAPTCHA_INVALID',
          message: '验证码错误或已过期，请刷新重试'
        })
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export const FAIL_THRESHOLD_VALUE = FAIL_THRESHOLD

/**
 * 测试用：清空内存计数器（生产无副作用）
 */
export function _resetLoginGuardForTests () {
  return failCache.clear()
}
