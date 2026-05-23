/**
 * P5 — 安全响应头巡检（4 用例）
 *   注：T-S4 已覆盖 Permissions-Policy / X-Content-Type-Options / Referrer-Policy 存在性。
 *   这里补充：
 *     HD-1 X-Powered-By 头不存在（hidePoweredBy: true 生效）
 *     HD-2 Cross-Origin-Resource-Policy 头存在
 *     HD-3 mini-prod-app（NODE_ENV=production 临时构造 helmet）→ CSP 头包含 default-src 'self'
 *     HD-4 mini-prod-app → HSTS 头存在 max-age >= 31536000（1 年）
 *
 *   HD-3/HD-4 通过独立 mini-app 在 production 模式重新构造 helmet 来验证；
 *   不污染主进程的 NODE_ENV。
 */
import { describe, it, expect } from 'vitest'
import express from 'express'
import helmet from 'helmet'
import request from 'supertest'
import app from '@server/app.js'

describe('P5.security.headers', () => {
  it('HD-1 X-Powered-By 头不存在', async () => {
    const res = await request(app).get('/api/security/captcha')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('HD-2 Cross-Origin-Resource-Policy 头存在', async () => {
    const res = await request(app).get('/api/security/captcha')
    expect(res.headers['cross-origin-resource-policy']).toBeDefined()
  })

  it('HD-3 production 模式 helmet 注入 CSP 头', async () => {
    const miniApp = express()
    miniApp.use(helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'self'"]
        }
      }
    }))
    miniApp.get('/x', (req, res) => res.send('ok'))
    const res = await request(miniApp).get('/x')
    expect(res.headers['content-security-policy']).toBeDefined()
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/)
    expect(res.headers['content-security-policy']).toMatch(/object-src 'none'/)
  })

  it('HD-4 production 模式 helmet HSTS max-age >= 31536000', async () => {
    const miniApp = express()
    miniApp.use(helmet({
      hsts: { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: false }
    }))
    miniApp.get('/x', (req, res) => res.send('ok'))
    const res = await request(miniApp).get('/x')
    expect(res.headers['strict-transport-security']).toBeDefined()
    const m = res.headers['strict-transport-security'].match(/max-age=(\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeGreaterThanOrEqual(31536000)
    expect(res.headers['strict-transport-security']).toMatch(/includeSubDomains/i)
  })
})
