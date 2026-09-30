/**
 * 第 6 批"安全增强"回归测试：
 *   T-S1  GET /api/security/captcha 返回滑块拼图契约字段（bg/piece/y/width/maxX 等）
 *   T-S2  滑块验证码 verify：targetX 容差 ±6 / 一次性消费 / 过期 / 篡改签名
 *   T-S3  连续 N 次错密码后再请求 /api/users/login 必须 428（CAPTCHA_REQUIRED / CAPTCHA_INVALID）
 *   T-S3b 登录成功只清精确键，不清 IP 松散键（防跨身份重置失败计数）
 *   T-S4  helmet 注入了 CSP（生产环境）/ Permissions-Policy / Referrer-Policy 等头部
 *   T-S5  AuditLog 在用户登录失败/成功时正确写入
 */
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import request from 'supertest'
import app from '@server/app.js'
import AuditLog from '@server/models/AuditLog.js'
import { TestDatabase } from '../setup/test-database.js'
import { issueCaptcha, verifyCaptcha } from '@server/utils/captcha.js'
import {
  FAIL_THRESHOLD_VALUE,
  _resetLoginGuardForTests,
  getFailCount,
  recordLoginFailure,
  clearLoginFailures
} from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
})

// 从 token 解出 targetX（payload 结构：ts|targetX|nonce|sig）
const decodeTargetX = (token) =>
  Number(Buffer.from(String(token), 'base64url').toString('utf8').split('|')[1])

// 解出 data URL 里的 SVG 原文
const decodeSvg = (dataUrl) =>
  decodeURIComponent(dataUrl.slice('data:image/svg+xml;utf8,'.length))

describe('T-S1 GET /api/security/captcha', () => {
  it('应返回滑块拼图契约字段', async () => {
    const res = await request(app).get('/api/security/captcha')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const d = res.body.data
    expect(typeof d.token).toBe('string')
    expect(d.token.length).toBeGreaterThan(10)
    expect(typeof d.bg).toBe('string')
    expect(d.bg.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    expect(typeof d.piece).toBe('string')
    expect(d.piece.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    expect(d.width).toBe(300)
    expect(d.height).toBe(150)
    expect(d.pieceWidth).toBe(44)
    expect(d.maxX).toBe(256)
    expect(d.y).toBeGreaterThanOrEqual(20)
    expect(d.y).toBeLessThanOrEqual(150 - 44 - 20)
    expect(d.expires_in_ms).toBe(5 * 60 * 1000)
  })

  it('背景 SVG 应在 (targetX, y) 处画缺口，且每次图案不同', async () => {
    const r1 = await request(app).get('/api/security/captcha')
    const r2 = await request(app).get('/api/security/captcha')
    const d1 = r1.body.data
    const bgSvg = decodeSvg(d1.bg)
    expect(bgSvg).toContain(`translate(${decodeTargetX(d1.token)} ${d1.y})`)
    expect(bgSvg).toContain('stroke-dasharray')
    // nonce 派生随机装饰：两次颁发的背景不应相同
    expect(d1.bg).not.toBe(r2.body.data.bg)
  })

  it('缺口与拼图块应使用同一形状 path', async () => {
    const res = await request(app).get('/api/security/captcha')
    const d = res.body.data
    // 注意要匹配 " d="（带前导空格），否则会先命中 gradient 的 id="g" / id="p"
    const mBg = decodeSvg(d.bg).match(/\sd="([^"]+)"/)
    const mPiece = decodeSvg(d.piece).match(/\sd="([^"]+)"/)
    expect(mBg).not.toBeNull()
    expect(mPiece).not.toBeNull()
    expect(mBg[1]).toBe(mPiece[1])
  })
})

describe('T-S2 滑块验证码自包含验证', () => {
  it('提交 targetX 应通过，容差 ±6 内也应通过', () => {
    const c1 = issueCaptcha()
    expect(verifyCaptcha(c1.token, decodeTargetX(c1.token))).toBe(true)
    const c2 = issueCaptcha()
    expect(verifyCaptcha(c2.token, decodeTargetX(c2.token) + 6)).toBe(true)
    const c3 = issueCaptcha()
    expect(verifyCaptcha(c3.token, decodeTargetX(c3.token) - 6)).toBe(true)
  })

  it('偏差超过容差（targetX + 20）应失败', () => {
    const { token } = issueCaptcha()
    expect(verifyCaptcha(token, decodeTargetX(token) + 20)).toBe(false)
  })

  it('非数字答案应失败', () => {
    const { token } = issueCaptcha()
    expect(verifyCaptcha(token, 'abc')).toBe(false)
  })

  it('伪造 token 应失败', () => {
    expect(verifyCaptcha('forged.invalid.token', 5)).toBe(false)
  })

  it('同一 token 二次消费应失败（防重放）', () => {
    const { token } = issueCaptcha()
    const x = decodeTargetX(token)
    expect(verifyCaptcha(token, x)).toBe(true)
    expect(verifyCaptcha(token, x)).toBe(false)
  })

  it('答错也会消费 token（一次性，防穷举）', () => {
    const { token } = issueCaptcha()
    const x = decodeTargetX(token)
    // 答错：nonce 已被核销
    expect(verifyCaptcha(token, x + 20)).toBe(false)
    // 同一 token 再提交正确位置也拒收
    expect(verifyCaptcha(token, x)).toBe(false)
  })

  it('过期 token 应失败', () => {
    // 用测试密钥自签一个 6 分钟前的 token（TTL 5 分钟）
    const ts = Date.now() - 6 * 60 * 1000
    const payload = `${ts}|120|expirednonce01`
    const sig = crypto.createHmac('sha256', process.env.CAPTCHA_SECRET).update(payload).digest('base64url')
    const token = Buffer.from(`${payload}|${sig}`, 'utf8').toString('base64url')
    expect(verifyCaptcha(token, 120)).toBe(false)
  })

  it('篡改签名的 token 应失败', () => {
    // 签名内容与 payload 不一致（签的是 targetX=999，payload 写 120）
    const ts = Date.now()
    const badSig = crypto.createHmac('sha256', process.env.CAPTCHA_SECRET).update(`${ts}|999|tampernonce001`).digest('base64url')
    const token = Buffer.from(`${ts}|120|tampernonce001|${badSig}`, 'utf8').toString('base64url')
    expect(verifyCaptcha(token, 120)).toBe(false)
  })

  it('targetX 应落在 [60, 220]，y 应落在 [20, 86]', () => {
    for (let i = 0; i < 50; i++) {
      const d = issueCaptcha()
      const x = decodeTargetX(d.token)
      expect(x).toBeGreaterThanOrEqual(60)
      expect(x).toBeLessThanOrEqual(220)
      expect(d.y).toBeGreaterThanOrEqual(20)
      expect(d.y).toBeLessThanOrEqual(150 - 44 - 20)
    }
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

    // 带伪造验证码重试：应 428 CAPTCHA_INVALID（或触发限流 429）
    const res2 = await request(app)
      .post('/api/users/login')
      .send({
        country_code: '+86',
        phone,
        password: 'wrong-pass-12345!',
        captcha_token: 'forged.invalid.token',
        captcha_answer: 0
      })
    expect([428, 429]).toContain(res2.status)
    if (res2.status === 428) {
      expect(res2.body.code).toBe('CAPTCHA_INVALID')
    }
  })
})

describe('T-S3b 登录成功不再清零 IP 共享计数', () => {
  it('clearLoginFailures 只清精确键，松散键按 TTL 保留（防跨身份重置）', () => {
    const req = { ip: '203.0.113.10' }
    recordLoginFailure(req, 'victim')
    recordLoginFailure(req, 'attacker')
    // 攻击者用自己账号登录成功：只清自己的精确键
    clearLoginFailures(req, 'attacker')
    // 松散键 ip::* 仍累计 2 次：受害者身份的失败计数不会被他人登录成功清零
    expect(getFailCount(req, 'victim')).toBe(2)
    // 攻击者自身也仍受 IP 级计数约束（精确键已清，松散键还在）
    expect(getFailCount(req, 'attacker')).toBe(2)
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
