/**
 * 密码重置 OTP 服务测试（passwordResetService）
 *
 * 安全敏感：OTP 的"发不出去就不入库""用一次就作废""不配短信服务不许重置"
 * 这三条一旦破了，就是能被用来接管账号的漏洞。
 *
 *   PR-1 开发环境：不配短信服务 → 直接返回 OTP 供测试
 *   PR-2 生产环境：不配短信服务 → 抛 503（不能"假装发了"）
 *   PR-3 短信网关返回非 2xx → 抛 502，且**不留有效 OTP**
 *   PR-4 短信网关正常 → OTP 入库，可被消费
 *   PR-5 消费一次即作废（同一 OTP 不能用第二次）
 *   PR-6 OTP 不匹配 → 消费失败
 *   PR-7 不存在的手机号 → 消费失败
 *   PR-8 状态查询反映短信服务是否配置
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createPasswordResetOtp,
  consumePasswordResetOtp,
  getPasswordResetStatus
} from '@server/services/passwordResetService.js'

const ENV_KEYS = ['SMS_WEBHOOK_URL', 'SMS_WEBHOOK_TOKEN', 'NODE_ENV']
let saved
let fetchMock

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
  delete process.env.SMS_WEBHOOK_URL
  delete process.env.SMS_WEBHOOK_TOKEN
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

const fakeUser = { id: 42 }

describe('密码重置 OTP 服务', () => {
  it('PR-1 开发环境：不配短信服务 → 直接返回 OTP 供测试', async () => {
    process.env.NODE_ENV = 'test'
    const res = await createPasswordResetOtp(fakeUser, '+66', '812345678')
    expect(res.devOtp).toMatch(/^\d{6}$/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PR-2 生产环境：不配短信服务 → 抛 503', async () => {
    process.env.NODE_ENV = 'production'
    await expect(createPasswordResetOtp(fakeUser, '+66', '812345678'))
      .rejects.toMatchObject({ status: 503 })
  })

  it('PR-3 短信网关返回非 2xx → 抛 502，且不留有效 OTP', async () => {
    process.env.SMS_WEBHOOK_URL = 'https://sms.example.com/send'
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    await expect(createPasswordResetOtp(fakeUser, '+66', '812345678'))
      .rejects.toMatchObject({ status: 502 })

    // 关键：发送失败就不能留下一个"用户从没收到但却有效"的 OTP
    const consumed = await consumePasswordResetOtp('+66', '812345678', '123456')
    expect(consumed).toBeNull()
  })

  it('PR-4 短信网关正常 → OTP 入库，可被消费', async () => {
    process.env.SMS_WEBHOOK_URL = 'https://sms.example.com/send'
    process.env.SMS_WEBHOOK_TOKEN = 'tok'
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const res = await createPasswordResetOtp(fakeUser, '+66', '812345678')
    expect(res.devOtp).toBeNull() // 已真实发送，不再回传
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.phone).toBe('812345678')
    expect(body.message).toContain('Universal Shop')

    // 库里那条 OTP 的明文在 body 里，用它消费
    const otp = /code is (\d{6})\./.exec(body.message)[1]
    const consumed = await consumePasswordResetOtp('+66', '812345678', otp)
    expect(consumed).toBeTruthy()
    expect(consumed.userId).toBe(42)
  })

  it('PR-5 消费一次即作废', async () => {
    process.env.NODE_ENV = 'test'
    const { devOtp } = await createPasswordResetOtp(fakeUser, '+66', '812345678')

    expect(await consumePasswordResetOtp('+66', '812345678', devOtp)).toBeTruthy()
    // 同一个 OTP 不能用第二次
    expect(await consumePasswordResetOtp('+66', '812345678', devOtp)).toBeNull()
  })

  it('PR-6 OTP 不匹配 → 消费失败', async () => {
    process.env.NODE_ENV = 'test'
    await createPasswordResetOtp(fakeUser, '+66', '812345678')
    expect(await consumePasswordResetOtp('+66', '812345678', '000000')).toBeNull()
  })

  it('PR-7 不存在的手机号 → 消费失败', async () => {
    process.env.NODE_ENV = 'test'
    await createPasswordResetOtp(fakeUser, '+66', '812345678')
    expect(await consumePasswordResetOtp('+66', '999999999', '123456')).toBeNull()
  })

  it('PR-8 状态查询反映短信服务是否配置', () => {
    delete process.env.SMS_WEBHOOK_URL
    expect(getPasswordResetStatus().smsConfigured).toBe(false)
    process.env.SMS_WEBHOOK_URL = 'https://sms.example.com/send'
    expect(getPasswordResetStatus().smsConfigured).toBe(true)
  })
})
