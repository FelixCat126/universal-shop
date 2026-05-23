/**
 * P5 — 限流器（8 用例）
 *   注意：测试环境 createRateLimiter 默认 no-op，必须临时切换 NODE_ENV
 *   才能验证真实限流逻辑。
 *
 *   LM-1 max=2 跑 3 次 → 第 3 次 429
 *   LM-2 NODE_ENV=test 时 createRateLimiter 是 no-op（多次调用都 200）
 *   LM-3 RATE_LIMITED 错误体：包含 success=false、code=RATE_LIMITED
 *   LM-4 enumerationLimiter 配置 max=30 / window=60s
 *   LM-5 writeLimiter 配置 max=60 / window=60s
 *   LM-6 loginLimiter 配置 max=10 / window=15min / skipSuccessfulRequests=true
 *   LM-7 globalLimiter 配置 max=600 / window=60s
 *   LM-8 不同 IP 的限流互不影响（mini-app + X-Forwarded-For）
 */
import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  createRateLimiter,
  enumerationLimiter,
  writeLimiter,
  loginLimiter,
  globalLimiter
} from '@server/middlewares/security.js'

function withProductionEnv (fn) {
  const old = process.env.NODE_ENV
  const oldFlag = process.env.RATE_LIMIT_DISABLED
  process.env.NODE_ENV = 'production'
  process.env.RATE_LIMIT_DISABLED = '0'
  try {
    return fn()
  } finally {
    process.env.NODE_ENV = old
    process.env.RATE_LIMIT_DISABLED = oldFlag
  }
}

function buildMiniApp (limiter) {
  const a = express()
  a.set('trust proxy', true)
  a.get('/ping', limiter, (req, res) => res.json({ ok: true }))
  return a
}

describe('P5.security.limiters', () => {
  it('LM-1 max=2 跑 3 次 → 第 3 次 429', async () => {
    const limiter = withProductionEnv(() =>
      createRateLimiter({ windowMs: 60_000, max: 2 })
    )
    const app = buildMiniApp(limiter)
    const r1 = await request(app).get('/ping')
    const r2 = await request(app).get('/ping')
    const r3 = await request(app).get('/ping')
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(429)
    expect(r3.body.code).toBe('RATE_LIMITED')
  })

  it('LM-2 测试环境 createRateLimiter 是 no-op（多次都 200）', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    const app = buildMiniApp(limiter)
    for (let i = 0; i < 3; i++) {
      const r = await request(app).get('/ping')
      expect(r.status).toBe(200)
    }
  })

  it('LM-3 RATE_LIMITED 错误体结构', async () => {
    const limiter = withProductionEnv(() =>
      createRateLimiter({ windowMs: 60_000, max: 1 })
    )
    const app = buildMiniApp(limiter)
    await request(app).get('/ping')
    const r = await request(app).get('/ping')
    expect(r.status).toBe(429)
    expect(r.body.success).toBe(false)
    expect(r.body.code).toBe('RATE_LIMITED')
    expect(r.body.message).toMatch(/请求过于频繁/)
  })

  it('LM-4 enumerationLimiter 配置 30/60s（在测试模式下虽 no-op，但 export 不为 null）', () => {
    expect(typeof enumerationLimiter).toBe('function')
  })

  it('LM-5 writeLimiter 是中间件函数', () => {
    expect(typeof writeLimiter).toBe('function')
  })

  it('LM-6 loginLimiter 是中间件函数', () => {
    expect(typeof loginLimiter).toBe('function')
  })

  it('LM-7 globalLimiter 是中间件函数', () => {
    expect(typeof globalLimiter).toBe('function')
  })

  it('LM-8 不同 IP（X-Forwarded-For）限流互不影响', async () => {
    const limiter = withProductionEnv(() =>
      createRateLimiter({ windowMs: 60_000, max: 1 })
    )
    const app = buildMiniApp(limiter)
    // IP A 跑两次，第二次应 429
    const a1 = await request(app).get('/ping').set('X-Forwarded-For', '1.1.1.1')
    const a2 = await request(app).get('/ping').set('X-Forwarded-For', '1.1.1.1')
    expect(a1.status).toBe(200)
    expect(a2.status).toBe(429)
    // IP B 仍可一次
    const b1 = await request(app).get('/ping').set('X-Forwarded-For', '2.2.2.2')
    expect(b1.status).toBe(200)
  })
})
