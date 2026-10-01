/**
 * P5 — 限流端到端真触发（4 用例，不连 DB）
 *
 *   security.js 在模块加载时根据 NODE_ENV 构造 limiter；测试环境下默认 no-op。
 *   本文件用 vi.resetModules + 临时 NODE_ENV=production 重新加载 security.js，
 *   把真实 globalLimiter / loginLimiter / writeLimiter / enumerationLimiter
 *   挂到独立 mini-app 的路由上，做端到端 supertest 验证。
 *
 *   差异于 security.limiters.test.js：
 *     - 那里走 createRateLimiter 工厂直接构造小窗口的 limiter
 *     - 这里检验的是 export 出来的 4 个生产 limiter 在真实路由位置上能命中 429
 */
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { withHttpServer } from '../helpers/test-helpers.js'

async function loadProdSecurity () {
  const old = process.env.NODE_ENV
  const oldFlag = process.env.RATE_LIMIT_DISABLED
  process.env.NODE_ENV = 'production'
  process.env.RATE_LIMIT_DISABLED = '0'
  try {
    // 强制重新执行 security.js 模块顶层（重建 limiter 实例）
    const url = new URL(
      `../../src/server/middlewares/security.js?prod=${Date.now()}`,
      import.meta.url
    )
    return await import(url.href)
  } finally {
    process.env.NODE_ENV = old
    process.env.RATE_LIMIT_DISABLED = oldFlag
  }
}

function buildApp (mod) {
  const app = express()
  // express-rate-limit 反对 trust proxy=true（会让攻击者伪造 IP 旁路限流），
  // 用 1 跳即可让 supertest 注入的 X-Forwarded-For 生效
  app.set('trust proxy', 1)
  app.use(express.json())
  // 用很大的 max 规避 globalLimiter 提前命中其他路由（仅 test-global 路由命中 globalLimiter）
  app.get('/any', mod.globalLimiter, (req, res) => res.json({ ok: true }))
  app.post('/login', mod.loginLimiter, (req, res) => {
    if (req.body?.bad) return res.status(401).json({ success: false })
    return res.json({ ok: true })
  })
  app.post('/write', mod.writeLimiter, (req, res) => res.json({ ok: true }))
  app.get('/enum', mod.enumerationLimiter, (req, res) => res.json({ ok: true }))
  return app
}

let prod
beforeEach(async () => {
  prod = await loadProdSecurity()
})

async function flood (app, method, path, ip, n) {
  let last
  for (let i = 0; i < n; i++) {
    last = await request(app)[method](path)
      .set('X-Forwarded-For', ip)
      .send(method === 'post' ? { bad: true } : undefined)
  }
  return last
}

describe('P5.security.limiters.e2e — 真实 limiter 挂在路由上', () => {
  it('LME-1 enumerationLimiter 30/min：第 31 次 → 429 + RATE_LIMITED', async () => {
    const app = buildApp(prod)
    // 跑 30 次 200 + 第 31 次应当 429
    for (let i = 0; i < 30; i++) {
      const r = await request(app).get('/enum').set('X-Forwarded-For', '10.0.0.1')
      expect(r.status).toBe(200)
    }
    const blocked = await request(app).get('/enum').set('X-Forwarded-For', '10.0.0.1')
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('RATE_LIMITED')

    // 不同 IP 仍可
    const otherIp = await request(app).get('/enum').set('X-Forwarded-For', '10.0.0.2')
    expect(otherIp.status).toBe(200)
  })

  it('LME-2 loginLimiter 10/15min skipSuccessful=true：连 10 次失败后第 11 次 429', async () => {
    const app = buildApp(prod)
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/login')
        .set('X-Forwarded-For', '10.0.1.1')
        .send({ bad: true })
      expect(r.status).toBe(401)
    }
    const blocked = await request(app).post('/login')
      .set('X-Forwarded-For', '10.0.1.1')
      .send({ bad: true })
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('RATE_LIMITED')
  })

  it('LME-3 writeLimiter 60/min：跑到 60 后第 61 次 429', async () => {
    const app = buildApp(prod)
    // 单实例 server 打满 60 次：避免逐请求新建 ephemeral server 的传输层抖动
    await withHttpServer(app, async (base) => {
      let lastOk = 0
      for (let i = 0; i < 60; i++) {
        const r = await request(base).post('/write').set('X-Forwarded-For', '10.0.2.1').send({})
        if (r.status === 200) lastOk++
      }
      expect(lastOk).toBe(60)
      const blocked = await request(base).post('/write').set('X-Forwarded-For', '10.0.2.1').send({})
      expect(blocked.status).toBe(429)
    })
  })

  it('LME-4 globalLimiter 600/min：单 IP 600 次正常，第 601 次 429', async () => {
    const app = buildApp(prod)
    await withHttpServer(app, async (base) => {
      let okCount = 0
      for (let i = 0; i < 600; i++) {
        const r = await request(base).get('/any').set('X-Forwarded-For', '10.0.3.1')
        if (r.status === 200) okCount++
      }
      expect(okCount).toBe(600)
      const blocked = await request(base).get('/any').set('X-Forwarded-For', '10.0.3.1')
      expect(blocked.status).toBe(429)
      expect(blocked.body.code).toBe('RATE_LIMITED')
    })
  })
})
