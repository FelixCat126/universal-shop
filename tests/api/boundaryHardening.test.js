/**
 * 边界加固专项（10 用例）
 *
 * 覆盖本轮深度审计发现并修复的边界问题：
 *   BD-1  验证码 token 不再携带明文答案（可被脚本解码绕过）
 *   BD-2  验证码 nonce 一次性消费是原子的（并发重放只有一个成功）
 *   BD-3  共享状态 increment 不重置 TTL（固定窗口，风控计数会衰减）
 *   BD-4  共享状态 setIfAbsent 原子消费
 *   BD-5  MemoryStore 有容量上限（防撑爆内存）
 *   BD-6  游客风控手机号归一化（改写格式不能绕过限额）
 *   BD-7  游客风控 Session-ID 需格式校验（任意伪造不计数）
 *   BD-8  积分无上限导致 INTEGER 溢出 → 400 而非 500
 *   BD-9  累计消费不含未支付/已取消订单
 *   BD-10 X-Request-ID 需校验（防日志伪造/响应头放大）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { issueCaptcha, verifyCaptcha, _getCaptchaAnswerForTests } from '@server/utils/captcha.js'
import { createSharedStore } from '@server/utils/sharedState.js'
import { _resetGuestOrderProtectionForTests, _setGuestOrderProtectionForTests } from '@server/middlewares/guestOrderGuard.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await _resetGuestOrderProtectionForTests()
  _setGuestOrderProtectionForTests({ threshold: 3, phoneLimit: 20, ipLimit: 100 })
})

async function makeUser (overrides = {}) {
  const { User } = models()
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
}

describe('Boundary.captcha', () => {
  it('BD-1 token 内不含明文答案', async () => {
    const c = await issueCaptcha()
    const raw = Buffer.from(c.token, 'base64url').toString('utf8')
    expect(raw.split('|').length).toBe(3)
    const answer = await _getCaptchaAnswerForTests(c.token)
    expect(answer).not.toBeNull()
    // token 的三段载荷分别是 ts / nonce / sig，都不应等于答案
    const parts = raw.split('|')
    expect(parts).not.toContain(String(answer))
  })

  it('BD-2 并发消费同一 token 只有一个成功（原子 nonce）', async () => {
    const c = await issueCaptcha()
    const answer = await _getCaptchaAnswerForTests(c.token)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyCaptcha(c.token, answer))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})

describe('Boundary.sharedState', () => {
  it('BD-3 increment 不重置 TTL（固定窗口）', async () => {
    const store = createSharedStore('test-window')
    await store.increment('k', 200)
    await new Promise(r => setTimeout(r, 120))
    await store.increment('k', 200)
    // 若 increment 重置 TTL，这里还能再等 200ms 才过期；固定窗口下应已接近过期
    await new Promise(r => setTimeout(r, 120))
    expect(await store.get('k')).toBeNull()
  })

  it('BD-4 setIfAbsent 只有第一次成功', async () => {
    const store = createSharedStore('test-setnx')
    expect(await store.setIfAbsent('k', 1, 1000)).toBe(true)
    expect(await store.setIfAbsent('k', 2, 1000)).toBe(false)
    expect(await store.get('k')).toBe(1)
  })

  it('BD-5 MemoryStore 容量有上限（防撑爆内存）', async () => {
    const store = createSharedStore('test-cap')
    for (let i = 0; i < 10050; i++) {
      await store.set(`k${i}`, i, 60_000)
    }
    // 超出上限后最早的条目被淘汰，Map 规模不随输入无限增长
    const size = store.map?.size
    if (typeof size === 'number') {
      // 上限 10000，淘汰在插入前执行，故允许短暂超出 1 条
      expect(size).toBeLessThanOrEqual(10001)
    }
  })
})

describe('Boundary.guestGuard', () => {
  it('BD-6 同一手机号的多种写法归一到同一限额 key', async () => {
    const { guestOrderGuard } = await import('@server/middlewares/guestOrderGuard.js')
    const calls = []
    const mkRes = () => {
      const res = { statusCode: 200, status (c) { this.statusCode = c; return this },
        json (b) { calls.push(b); return this } }
      return res
    }
    const mkReq = (phone) => ({ body: { contact_phone: phone }, ip: '1.2.3.4', headers: {} })

    // 同一号码三种写法，各自都应计入同一个手机号计数
    for (const p of ['0812345678', '081-234-5678', '+66812345678']) {
      await guestOrderGuard(mkReq(p), mkRes(), () => {})
    }
    // 阈值设为 3：三次后应触发验证码要求（428）
    const last = calls[calls.length - 1]
    expect(last?.code).toBe('CAPTCHA_REQUIRED')
  })

  it('BD-7 格式非法的 Session-ID 不计入会话维度', async () => {
    const { guestOrderGuard } = await import('@server/middlewares/guestOrderGuard.js')
    const calls = []
    const mkRes = () => ({
      statusCode: 200,
      status (c) { this.statusCode = c; return this },
      json (b) { calls.push(b); return this }
    })
    // 每次带不同的非法 Session-ID，会话维度不应被计数
    for (let i = 0; i < 5; i++) {
      await guestOrderGuard(
        { body: { contact_phone: `08123456${i}` }, ip: `9.9.9.${i}`, headers: { 'session-id': 'x' } },
        mkRes(),
        () => {}
      )
    }
    // 手机号/IP 各自不同 → 不应触发验证码（说明非法 Session-ID 没被计入）
    expect(calls.some(c => c.code === 'CAPTCHA_REQUIRED')).toBe(false)
  })
})

describe('Boundary.points', () => {
  it('BD-8 超大积分返回 400 而不是 500', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${await adminToken()}`)
      .send({
        name: '超大积分商品',
        price: 10,
        points: 2000000000,
        stock: 10,
        category_id: await anyCategoryId()
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/积分/)
  })
})

describe('Boundary.spentTotal', () => {
  it('BD-9 累计消费不含未支付与已取消订单', async () => {
    const { Order } = models()
    const user = await makeUser()
    await Order.create({
      order_no: 'TEST-PAID-1',
      user_id: user.id,
      total_amount: 100,
      total_amount_thb: 100,
      payment_method: 'cod',
      status: 'shipping'
    })
    await Order.create({
      order_no: 'TEST-PENDING-1',
      user_id: user.id,
      total_amount: 500,
      total_amount_thb: 500,
      payment_method: 'cod',
      status: 'pending'
    })
    await Order.create({
      order_no: 'TEST-CANCELLED-1',
      user_id: user.id,
      total_amount: 300,
      total_amount_thb: 300,
      payment_method: 'cod',
      status: 'cancelled'
    })

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${TestHelpers.generateToken(user)}`)
    expect(res.status).toBe(200)
    expect(Number(res.body.data.spent_thb_sum)).toBe(100)
  })
})

describe('Boundary.requestId', () => {
  it('BD-10 非法 X-Request-ID 被替换为服务端生成值', async () => {
    const res = await request(app)
      .get('/api/system-config/public')
      .set('X-Request-ID', 'bad id with spaces')
    expect(res.status).toBe(200)
    const rid = res.headers['x-request-id']
    expect(rid).toBeTruthy()
    expect(rid).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(rid).not.toContain(' ')
  })
})

// --- helpers ---
async function adminToken () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return TestHelpers.generateAdminToken(admin)
}

async function anyCategoryId () {
  const { ProductCategory } = models()
  const cat = await ProductCategory.create({ name: 'cat-' + Date.now(), sort_order: 1 })
  return cat.id
}
