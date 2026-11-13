import crypto from 'crypto'
import { isSharedStateDistributed } from '../utils/sharedState.js'
import sequelize from '../config/database.js'

/** 慢请求阈值（毫秒）—— 超过就算"慢" */
const SLOW_REQUEST_MS = 1000

const stats = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  totalDurationMs: 0,
  slowRequests: 0
}

export function observabilityMiddleware (req, res, next) {
  /**
   * X-Request-ID 优先用客户端传入的值，便于跨服务追踪；
   * 但必须做长度与字符集校验 —— 未校验就回写响应头/写日志，
   * 攻击者可用超长值放大响应头，或用换行伪造日志行。
   */
  const raw = req.headers['x-request-id']
  const candidate = typeof raw === 'string' ? raw.trim() : ''
  const requestId = /^[A-Za-z0-9_-]{1,64}$/.test(candidate)
    ? candidate
    : crypto.randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-ID', requestId)
  const t0 = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - t0
    stats.requests++
    stats.totalDurationMs += duration
    if (res.statusCode >= 500) stats.errors++
    if (duration > SLOW_REQUEST_MS) stats.slowRequests++
  })
  next()
}

export function getRuntimeMetrics () {
  const elapsed = Math.max(1, Date.now() - stats.startedAt)
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    processStartTime: new Date(stats.startedAt).toISOString(),
    requests: stats.requests,
    errors: stats.errors,
    errorRate: stats.requests ? Number((stats.errors / stats.requests).toFixed(4)) : 0,
    avgDurationMs: stats.requests ? Math.round(stats.totalDurationMs / stats.requests) : 0,
    /**
     * 慢请求数（超过 1 秒）。平均耗时会骗人：
     * 绝大多数请求 2ms、偶尔一个 8 秒，平均值看着正常，但用户已经投诉了。
     */
    slowRequests: stats.slowRequests,
    requestsPerMinute: Number((stats.requests / (elapsed / 60000)).toFixed(2)),
    memory: process.memoryUsage(),
    /**
     * 数据库连接池状态 —— 排查"请求全卡住"的第一现场。
     *
     * borrowed 接近 size、pending > 0 = 连接池被打满：
     * 新来的请求在排队等连接，表现为接口全量变慢但 CPU 很低。
     * 没有这几个数字就只能靠猜。
     */
    databasePool: poolStatus(),
    sharedStateDistributed: isSharedStateDistributed(),
    node: process.version
  }
}

/** 读取 sequelize 连接池状态（拿不到就返回 null，不影响端点本身） */
function poolStatus () {
  try {
    const pool = sequelize.connectionManager?.pool
    if (!pool) return null
    return {
      size: pool.size ?? null,
      available: typeof pool.available === 'number' ? pool.available : null,
      borrowed: typeof pool.borrowed === 'number' ? pool.borrowed : null,
      pending: typeof pool.pending === 'number' ? pool.pending : null
    }
  } catch {
    return null
  }
}
