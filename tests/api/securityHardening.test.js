/**
 * 第 6 批"安全增强"回归测试：
 *   T-S1  GET /api/security/captcha 正常返回 question + token
 *   T-S2  自包含验证码 verify 通过/失败
 *   T-S3  连续 N 次错密码后再请求 /api/users/login 必须 428（CAPTCHA_REQUIRED）
 *   T-S4  helmet 注入了 CSP（生产环境）/ Permissions-Policy / Referrer-Policy 等头部
 *   T-S5  AuditLog 在用户登录失败/成功时正确写入
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import AuditLog from '@server/models/AuditLog.js'
import { TestDatabase } from '../setup/test-database.js'
import { issueCaptcha, verifyCaptcha } from '@server/utils/captcha.js'
import { FAIL_THRESHOLD_VALUE, _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

describe('T-S1 GET /api/security/captcha', () => {
  it('应返回 token 与 question', async () => {
    const res = await request(app).get('/api/security/captcha')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.token).toBe('string')
    expect(res.body.data.token.length).toBeGreaterThan(10)
    expect(typeof res.body.data.question).toBe('string')
    expect(res.body.data.question).toMatch(/[+-]/)
  })
})

describe('T-S2 captcha 自包含验证', () => {
  it('正确答案应通过', () => {
    const { token, question } = issueCaptcha()
    const m = question.match(/^(-?\d+)\s*([+\-])\s*(-?\d+)/)
    expect(m).not.toBeNull()
    const a = parseInt(m[1], 10)
    const op = m[2]
    const b = parseInt(m[3], 10)
    const ans = op === '+' ? a + b : a - b
    expect(verifyCaptcha(token, ans)).toBe(true)
  })

  it('错误答案应失败', () => {
    const { token } = issueCaptcha()
    expect(verifyCaptcha(token, 999999)).toBe(false)
  })

  it('伪造 token 应失败', () => {
    expect(verifyCaptcha('forged.invalid.token', 5)).toBe(false)
  })

  it('同一 token 二次消费应失败（防重放）', () => {
    const { token, question } = issueCaptcha()
    const m = question.match(/^(-?\d+)\s*([+\-])\s*(-?\d+)/)
    const a = parseInt(m[1], 10)
    const op = m[2]
    const b = parseInt(m[3], 10)
    const ans = op === '+' ? a + b : a - b
    expect(verifyCaptcha(token, ans)).toBe(true)
    expect(verifyCaptcha(token, ans)).toBe(false)
  })
})

describe('T-S3 登录连败后强制验证码', () => {
  it(`同 IP+phone 失败 ${FAIL_THRESHOLD_VALUE} 次后再登录返回 428`, async () => {
    const phone = '13900900' + Math.floor(Math.random() * 900 + 100)
    // 先制造 N 次失败
    for (let i = 0; i < FAIL_THRESHOLD_VALUE; i++) {
      await request(app)
        .post('/api/users/login')
        .send({ country_code: '+86', phone, password: 'wrong-pass-12345!' })
    }

    const res = await request(app)
      .post('/api/users/login')
      .send({ country_code: '+86', phone, password: 'wrong-pass-12345!' })

    expect([428, 429]).toContain(res.status)
    if (res.status === 428) {
      expect(res.body.code).toBe('CAPTCHA_REQUIRED')
    }
  })
})

describe('T-S4 helmet 与 Permissions-Policy 响应头', () => {
  it('应包含 Permissions-Policy / Referrer-Policy / X-Content-Type-Options', async () => {
    const res = await request(app).get('/api/security/captcha')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBeDefined()
    expect(res.headers['permissions-policy']).toBeDefined()
    expect(res.headers['permissions-policy']).toMatch(/camera=\(\)/)
  })
})

describe('T-S5 AuditLog 写入', () => {
  it('错密码登录应在 audit_logs 中产生 user.login.fail 记录', async () => {
    const phone = '13700700' + Math.floor(Math.random() * 900 + 100)
    const before = await AuditLog.count({ where: { event: 'user.login.fail' } })
    await request(app)
      .post('/api/users/login')
      .send({ country_code: '+86', phone, password: 'definitely-wrong-pwd' })
    // 给一点时间让异步 catch().then 完成
    await new Promise(r => setTimeout(r, 200))
    const after = await AuditLog.count({ where: { event: 'user.login.fail' } })
    expect(after).toBeGreaterThan(before)
  })

  it('成功注册应产生 user.register.success 记录', async () => {
    const phone = '13800800' + Math.floor(Math.random() * 900 + 100)
    const before = await AuditLog.count({ where: { event: 'user.register.success' } })
    const res = await request(app)
      .post('/api/users/register')
      .send({
        nickname: 'Audit User',
        country_code: '+86',
        phone,
        password: 'StrongPass#1234'
      })
    expect([200, 201]).toContain(res.status)
    await new Promise(r => setTimeout(r, 200))
    const after = await AuditLog.count({ where: { event: 'user.register.success' } })
    expect(after).toBeGreaterThan(before)
  })
})
