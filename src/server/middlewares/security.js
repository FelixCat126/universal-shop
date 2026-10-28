/**
 * 集中式安全/防护中间件：CORS 白名单、限流器工厂、helmet、CSP
 * 通过环境变量控制，避免硬编码：
 *   ALLOWED_ORIGINS  - 逗号分隔；不配置则回退到自身域（生产环境强烈建议配置）
 *   RATE_LIMIT_DISABLED=1  - 仅在测试环境用，跳过限流
 *   TRUST_PROXY  - 0|1|true|false|loopback|<int>
 */

import rateLimit from 'express-rate-limit'
import { createSharedStore, isSharedStateDistributed } from '../utils/sharedState.js'
import { logger } from '../utils/logger.js'

/**
 * 共享限流 store（Redis 或进程内 Map）
 *
 * Redis 故障降级：Redis 不可用时**放行并告警**，而不是把错误抛给 express-rate-limit
 * （v7 的 passOnStoreError 默认为 false，store 抛错会一路冒泡成 500，
 *   Redis 一重启就全站接口挂掉）。限流是保护措施，不该成为单点故障。
 */
function createSharedRateLimitStore (namespace, windowMs) {
  const cache = createSharedStore(`rate-limit:${namespace}`)
  // 降级期内的本地计数：Redis 恢复前仍能对单实例做基本限流
  const fallback = new Map()
  let degraded = false

  const fallbackIncrement = (key) => {
    const now = Date.now()
    const row = fallback.get(key)
    if (!row || row.resetAt <= now) {
      fallback.set(key, { count: 1, resetAt: now + windowMs })
      return 1
    }
    row.count += 1
    return row.count
  }

  return {
    async increment (key) {
      try {
        const totalHits = await cache.increment(key, windowMs)
        if (degraded) {
          degraded = false
          logger.warn('[rate-limit] 共享存储已恢复', { namespace })
        }
        return { totalHits, resetTime: new Date(Date.now() + windowMs) }
      } catch (err) {
        if (!degraded) {
          degraded = true
          logger.error('[rate-limit] 共享存储不可用，降级为本地计数', {
            namespace, err: err?.message
          })
        }
        const totalHits = fallbackIncrement(key)
        return { totalHits, resetTime: new Date(Date.now() + windowMs) }
      }
    },
    async decrement (key) {
      try {
        const current = await cache.get(key)
        if (current != null) {
          await cache.set(key, Math.max(0, Number(current) - 1), windowMs)
        }
      } catch (err) {
        const row = fallback.get(key)
        if (row) row.count = Math.max(0, row.count - 1)
      }
    },
    async resetKey (key) {
      fallback.delete(key)
      try {
        await cache.delete(key)
      } catch { /* 降级期忽略 */ }
    },
    async resetAll () {
      fallback.clear()
      try {
        await cache.clear()
      } catch { /* 降级期忽略 */ }
    }
  }
}

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
  const { namespace = 'default', ...rest } = opts
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
    ...(isSharedStateDistributed()
      ? { store: createSharedRateLimitStore(namespace, rest.windowMs || 60_000) }
      : {}),
    ...rest
  })
}

/** 登录类（admin/user/partner）：每 IP 10 次/15 分；上限到达开始拒绝 */
export const loginLimiter = createRateLimiter({
  namespace: 'login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true
})

/** 业务写入类（下单/支付确认/上传/资料修改）：每 IP 60 次/分 */
export const writeLimiter = createRateLimiter({
  namespace: 'write',
  windowMs: 60 * 1000,
  max: 60
})

/** 查询枚举类（check-phone/verify-referral 等）：每 IP 30 次/分 */
export const enumerationLimiter = createRateLimiter({
  namespace: 'enumeration',
  windowMs: 60 * 1000,
  max: 30
})

/** 数据导出类：每 IP 10 次/分，防止大结果集拖垮内存与 DB */
export const exportLimiter = createRateLimiter({
  namespace: 'export',
  windowMs: 60 * 1000,
  max: 10
})

/** 忘记密码/重置密码：每 IP 5 次/15 分 */
export const passwordResetLimiter = createRateLimiter({
  namespace: 'password-reset',
  windowMs: 15 * 60 * 1000,
  max: 5
})

/** 全局兜底：每 IP 600 次/分钟，挡 CC 风暴；正常流量不受影响 */
export const globalLimiter = createRateLimiter({
  namespace: 'global',
  windowMs: 60 * 1000,
  max: 600
})
