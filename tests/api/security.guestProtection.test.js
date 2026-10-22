/**
 * 游客反滥用 + 忘记密码 + 空账号清理（6 用例）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { issueCaptcha } from '@server/utils/captcha.js'
import { _resetGuestOrderProtectionForTests, _setGuestOrderProtectionForTests } from '@server/middlewares/guestOrderGuard.js'
import { cleanupAbandonedGuestAccounts } from '@server/services/guestAccountCleanup.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await _resetGuestOrderProtectionForTests()
  _setGuestOrderProtectionForTests({ threshold: 3, phoneLimit: 20, ipLimit: 100 })
})

const models = () => TestDatabase.getSequelize().models

async function activeProduct () {
  const { Product, ProductCategory } = models()
  const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
  return Product.create(TestDataFactory.createProduct({ stock: 100, price: 100, category_id: cat.id, status: 'active' }))
}

async function makeUser (overrides = {}) {
  const { User } = models()
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  }))
}

function decodeTargetX (token) {
  return Number(Buffer.from(token, 'base64url').toString('utf8').split('|')[1])
}

function orderBody (product, phone, extra = {}) {
  return {
    items: [{ product_id: product.id, quantity: 1 }],
    contact_name: '游客',
    contact_phone: phone,
    delivery_address: '地址',
    province: '曼谷',
    city: '曼谷',
    detail_address: '路 1 号',
    postal_code: '10330',
    ...extra
  }
}

describe('Security.guestProtection', () => {
  it('GP-1 超阈值后游客下单强制验证码；正确滑块后可继续', async () => {
    await seedSystemConfigBaseline()
    _setGuestOrderProtectionForTests({ threshold: 2 })
    const product = await activeProduct()
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`

    const first = await request(app).post('/api/orders').send(orderBody(product, phone))
    expect(first.status).toBe(201)

    const second = await request(app).post('/api/orders').send(orderBody(product, phone))
    expect(second.status).toBe(428)
    expect(second.body.code).toBe('CAPTCHA_REQUIRED')

    const { token } = issueCaptcha()
    const third = await request(app).post('/api/orders').send(orderBody(product, phone, {
      captcha_token: token,
      captcha_answer: decodeTargetX(token)
    }))
    expect(third.status).toBe(201)
  })

  it('GP-2 超过手机号硬上限直接 429', async () => {
    await seedSystemConfigBaseline()
    _setGuestOrderProtectionForTests({ threshold: 99, phoneLimit: 1 })
    const product = await activeProduct()
    const phone = `+86${TestHelpers.generatePhoneNumber('+86')}`
    await request(app).post('/api/orders').send(orderBody(product, phone))
    const res = await request(app).post('/api/orders').send(orderBody(product, phone))
    expect(res.status).toBe(429)
    expect(res.body.code).toBe('GUEST_ORDER_RATE_LIMITED')
  })

  it('GP-3 忘记密码完整流程：OTP 重置 → 新密码可登录 → 旧 token 失效', async () => {
    const user = await makeUser()
    const oldToken = TestHelpers.generateToken(user)
    const { token } = issueCaptcha()

    const forgot = await request(app).post('/api/users/forgot-password').send({
      country_code: '+86',
      phone: user.phone,
      captcha_token: token,
      captcha_answer: decodeTargetX(token)
    })
    expect(forgot.status).toBe(200)
    expect(forgot.body.dev_otp).toBeTruthy()

    const reset = await request(app).post('/api/users/reset-password').send({
      country_code: '+86',
      phone: user.phone,
      otp: forgot.body.dev_otp,
      new_password: 'Resetpass1234'
    })
    expect(reset.status).toBe(200)

    const old = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${oldToken}`)
    expect(old.status).toBe(401)

    const login = await request(app).post('/api/users/login').send({
      country_code: '+86',
      phone: user.phone,
      password: 'Resetpass1234'
    })
    expect(login.status).toBe(200)
  })

  it('GP-4 错误 OTP 不能重置；未知手机号返回统一提示且不泄露是否存在', async () => {
    const user = await makeUser()
    const { token } = issueCaptcha()
    const forgot = await request(app).post('/api/users/forgot-password').send({
      country_code: '+86',
      phone: user.phone,
      captcha_token: token,
      captcha_answer: decodeTargetX(token)
    })
    expect(forgot.status).toBe(200)

    const bad = await request(app).post('/api/users/reset-password').send({
      country_code: '+86',
      phone: user.phone,
      otp: '000000',
      new_password: 'Resetpass1234'
    })
    expect(bad.status).toBe(400)

    const { token: token2 } = issueCaptcha()
    const unknown = await request(app).post('/api/users/forgot-password').send({
      country_code: '+86',
      phone: TestHelpers.generatePhoneNumber('+86'),
      captcha_token: token2,
      captcha_answer: decodeTargetX(token2)
    })
    expect(unknown.status).toBe(200)
    expect(unknown.body.dev_otp).toBeNull()
  })

  it('GP-5 清理 7 天前无订单游客账号，保留有订单账号', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    const abandoned = await makeUser({ must_reset_password: true, created_at: oldDate })
    const withOrder = await makeUser({ must_reset_password: true, created_at: oldDate })
    const { Order } = models()
    await Order.create({
      order_no: `T${Date.now()}`,
      user_id: withOrder.id,
      total_amount: 100,
      total_amount_thb: 100,
      contact_name: 'X',
      contact_phone: withOrder.phone,
      delivery_address: 'A',
      status: 'shipping',
      payment_method: 'cod'
    })

    const deleted = await cleanupAbandonedGuestAccounts({ olderThanDays: 7 })
    expect(deleted).toBe(1)
    const { User } = models()
    expect(await User.findByPk(abandoned.id)).toBeNull()
    expect(await User.findByPk(withOrder.id)).not.toBeNull()
  })

  it('GP-6 近期游客空账号不会被误清理', async () => {
    const recent = await makeUser({ must_reset_password: true })
    const deleted = await cleanupAbandonedGuestAccounts({ olderThanDays: 7 })
    expect(deleted).toBe(0)
    const { User } = models()
    expect(await User.findByPk(recent.id)).not.toBeNull()
  })
})
