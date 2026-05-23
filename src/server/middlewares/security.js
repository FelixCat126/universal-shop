/**
 * 集中式安全/防护中间件：CORS 白名单、限流器工厂、helmet、CSP
 * 通过环境变量控制，避免硬编码：
 *   ALLOWED_ORIGINS  - 逗号分隔；不配置则回退到自身域（生产环境强烈建议配置）
 *   RATE_LIMIT_DISABLED=1  - 仅在测试环境用，跳过限流
 *   TRUST_PROXY  - 0|1|true|false|loopback|<int>
 */

import rateLimit from 'express-rate-limit'

/** 解析 ALLOWED_ORIGINS（包含 http/https 与端口） */
function parseAllowedOrigins () {
  const raw = process.env.ALLOWED_ORIGINS
  if (!raw) return null
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * CORS 选项：开发回退到任意来源，生产/测试要求白名单。
 * 注意：response 头会回写"恰好这个 origin"而不是 *，避免与 credentials 冲突。
 */
export function buildCorsOptions () {
  const allowed = parseAllowedOrigins()
  return {
    origin (origin, cb) {
      // 同源/curl/服务端调用没有 Origin
      if (!origin) return cb(null, true)
      if (!allowed || allowed.length === 0) {
        if (process.env.NODE_ENV === 'production') {
          return cb(null, false)
        }
        return cb(null, true)
      }
      if (allowed.includes(origin)) return cb(null, true)
      return cb(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Session-ID'],
    exposedHeaders: ['Session-ID'],
    maxAge: 600
  }
}

const isLimiterDisabled = () =>
  process.env.RATE_LIMIT_DISABLED === '1' || process.env.NODE_ENV === 'test'

/**
 * 通用限流器工厂；测试环境/显式禁用时返回 no-op 中间件。
 */
export function createRateLimiter (opts) {
  if (isLimiterDisabled()) {
    return (req, res, next) => next()
  }
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    handler (req, res, _next, options) {
      res.status(options.statusCode).json({
        success: false,
        message: '请求过于频繁，请稍后再试',
        code: 'RATE_LIMITED'
      })
    },
    ...opts
  })
}

/** 登录类（admin/user/partner）：每 IP 10 次/15 分；上限到达开始拒绝 */
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true
})

/** 业务写入类（下单/支付确认/上传/资料修改）：每 IP 60 次/分 */
export const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60
})

/** 查询枚举类（check-phone/verify-referral 等）：每 IP 30 次/分 */
export const enumerationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30
})

/** 全局兜底：每 IP 600 次/分钟，挡 CC 风暴；正常流量不受影响 */
export const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600
})
