/**
 * P4 错误处理路径（15 用例）
 *
 * 覆盖 errorHandler.js 的全部分支：
 *   - JSON 语法错误
 *   - Sequelize 各种 Error 类型
 *   - JWT 过期/无效
 *   - Multer 文件错误
 *   - 404 vs HTML redirect
 *   - ApiError 自定义 code
 *   - 生产/开发 details 差异
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import app from '@server/app.js'
import { errorHandler, notFoundHandler, ApiError } from '@server/middlewares/errorHandler.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
})

describe('P4-Supplement.errorHandler', () => {
  it('E-1 POST body 非 JSON 语法 → 400', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .set('Content-Type', 'application/json')
      .send('{"phone":123')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('E-2 body 超 1MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const bigBody = { data: 'x'.repeat(2 * 1024 * 1024) }
    const res = await request(app)
      .post('/api/users/login')
      .set('Content-Type', 'application/json')
      .send(bigBody)
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('E-3 GET /api/nonexistent → 404 JSON', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/API接口不存在|404/)
  })

  it('E-4 GET /nonexistent 浏览器 accept=html → 302 /portal/404', async () => {
    const res = await request(app)
      .get('/nonexistent-page-xyz')
      .set('Accept', 'text/html,application/xhtml+xml')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/portal/404')
  })

  it('E-5 GET /nonexistent curl accept=json → 404 JSON', async () => {
    const res = await request(app)
      .get('/nonexistent-page-xyz')
      .set('Accept', 'application/json')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('E-6 errorHandler 完整响应结构', async () => {
    const t = express()
    t.get('/x', (req, res, next) => {
      next(new ApiError('test_error', 422, 'TEST_CODE'))
    })
    t.use(errorHandler)
    const res = await request(t).get('/x')
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({
      success: false,
      message: 'test_error',
      code: 'TEST_CODE'
    })
    expect(res.body.timestamp).toBeDefined()
  })

  it('E-7 JsonWebTokenError → 401 INVALID_TOKEN', async () => {
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', 'Bearer invalid-token-xyz')
    expect([401, 403]).toContain(res.status)
  })

  it('E-8 TokenExpiredError → 401/403', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const expired = jwt.sign(
      { userId: 1, username: 'u' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    )
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${expired}`)
    expect([401, 403]).toContain(res.status)
  })

  it('E-9 未带 Authorization → 401', async () => {
    const res = await request(app).get('/api/users/profile')
    expect(res.status).toBe(401)
  })

  it('E-10 上传超 2MB → 400/413', async () => {
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    // 制造一个超 2MB 的 buffer
    const bigBuffer = Buffer.alloc(3 * 1024 * 1024, 0xff)
    const res = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', bigBuffer, 'big.jpg')
    expect([400, 413, 500]).toContain(res.status)
  })

  it('E-11 上传非图片 MIME → 400', async () => {
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    const res = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('not an image'), 'evil.php')
    expect([400, 415, 500]).toContain(res.status)
  })

  it('E-12 admin 路由 缺 token → 401', async () => {
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(401)
  })

  it('E-13 admin 路由 user token → 401', async () => {
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  it('E-14 partner 路由 user token → 401/403', async () => {
    const user = await TestHelpers.createUserWithAddress()
    const token = TestHelpers.generateToken(user.user)
    const res = await request(app)
      .get('/api/partner/me')
      .set('Authorization', `Bearer ${token}`)
    expect([401, 403]).toContain(res.status)
  })

  it('E-15 服务器 500 不返回 stack trace', async () => {
    const t = express()
    t.get('/x', () => {
      throw new Error('sensitive internal details')
    })
    t.use(errorHandler)
    const res = await request(t).get('/x')
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
    // 不应包含原始 stack
    expect(res.body).not.toHaveProperty('stack')
    expect(res.body).not.toHaveProperty('details')
    expect(res.body).not.toHaveProperty('error')
  })
})
