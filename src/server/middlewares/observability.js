import crypto from 'crypto'
import { isSharedStateDistributed } from '../utils/sharedState.js'

const stats = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  totalDurationMs: 0
}

export function observabilityMiddleware (req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-ID', requestId)
  const t0 = Date.now()
  res.on('finish', () => {
    stats.requests++
    stats.totalDurationMs += Date.now() - t0
    if (res.statusCode >= 500) stats.errors++
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
    requestsPerMinute: Number((stats.requests / (elapsed / 60000)).toFixed(2)),
    memory: process.memoryUsage(),
    sharedStateDistributed: isSharedStateDistributed(),
    node: process.version
  }
}
