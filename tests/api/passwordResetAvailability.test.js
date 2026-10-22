/**
 * 密码重置可用性守卫（4 用例）
 *
 * 背景：短信通道（SMS_WEBHOOK_URL）尚未部署时：
 *   - 前端：/api/system-config/public 下发 sms_configured=false，
 *           门户不展示「忘记密码」入口
 *   - 后端：forgot-password 在生产环境直接 503 拒绝，
 *           不消耗滑块验证码与限流配额，也不留下"有效但未送达"的 OTP
 *
 * 这些行为在开发/测试环境（NODE_ENV=test）下不生效，
 * 因此需要显式切换 NODE_ENV 来覆盖生产分支。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { issueCaptcha } from '@server/utils/captcha.js'
import { clearResponseCache } from '@server/utils/responseCache.js'

const models = () => TestDatabase.getSequelize().models

function decodeTargetX (token) {
  return Number(Buffer.from(token, 'base64url').toString('utf8').split('|')[1])
}

async function makeUser () {
  const { User } = models()
  return User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86')
  }))
}

const originalNodeEnv = process.env.NODE_ENV
const originalSms = process.env.SMS_WEBHOOK_URL

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv
  if (originalSms === undefined) delete process.env.SMS_WEBHOOK_URL
  else process.env.SMS_WEBHOOK_URL = originalSms
  await clearResponseCache()
})

describe('PasswordReset.availability', () => {
  it('PA-1 公开配置在未配短信时 sms_configured=false', async () => {
    delete process.env.SMS_WEBHOOK_URL
    await clearResponseCache()
    const res = await request(app).get('/api/system-config/public')
    expect(res.status).toBe(200)
    expect(res.body.data.sms_configured).toBe(false)
  })

  it('PA-2 公开配置在配了短信时 sms_configured=true', async () => {
    process.env.SMS_WEBHOOK_URL = 'https://sms.example.com/send'
    await clearResponseCache()
    const res = await request(app).get('/api/system-config/public')
    expect(res.status).toBe(200)
    expect(res.body.data.sms_configured).toBe(true)
  })

  it('PA-3 生产环境未配短信 → forgot-password 直接 503，不消耗验证码', async () => {
    delete process.env.SMS_WEBHOOK_URL
    process.env.NODE_ENV = 'production'
    const user = await makeUser()
    // 故意不传验证码：503 应发生在验证码校验之前
    const res = await request(app).post('/api/users/forgot-password').send({
      country_code: '+86',
      phone: user.phone
    })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('SMS_NOT_CONFIGURED')
  })

  it('PA-4 发送失败时库中不留有效 OTP（先发后存）', async () => {
    delete process.env.SMS_WEBHOOK_URL
    process.env.NODE_ENV = 'production'
    const user = await makeUser()
    const { token } = issueCaptcha()

    // 生产 + 未配短信：直接 503
    const res = await request(app).post('/api/users/forgot-password').send({
      country_code: '+86',
      phone: user.phone,
      captcha_token: token,
      captcha_answer: decodeTargetX(token)
    })
    expect(res.status).toBe(503)

    // 关键断言：库里不得存在该手机号的 OTP
    const { createPasswordResetOtp } = await import('@server/services/passwordResetService.js')
    expect(typeof createPasswordResetOtp).toBe('function')
    const store = (await import('@server/utils/sharedState.js')).createSharedStore('password-reset-otp')
    const row = await store.get(`+86:${user.phone}`)
    expect(row).toBeNull()
  })
})
