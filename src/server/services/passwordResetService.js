import crypto from 'crypto'
import { createSharedStore } from '../utils/sharedState.js'
import { logger } from '../utils/logger.js'

const store = createSharedStore('password-reset-otp')
const OTP_TTL_MS = 10 * 60 * 1000

function hashOtp (otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex')
}

async function deliverOtp ({ countryCode, phone, otp }) {
  if (process.env.SMS_WEBHOOK_URL) {
    const response = await fetch(process.env.SMS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` }
          : {})
      },
      body: JSON.stringify({
        country_code: countryCode,
        phone,
        message: `Your Universal Shop password reset code is ${otp}. Valid for 10 minutes.`
      })
    })
    if (!response.ok) {
      const err = new Error('SMS 发送失败，请稍后重试')
      err.status = 502
      throw err
    }
    return true
  }

  if (process.env.NODE_ENV === 'production') {
    const err = new Error('短信服务未配置，暂时无法重置密码')
    err.status = 503
    throw err
  }

  // 开发/测试环境不发送真实短信，直接返回给调用方用于验证流程
  return false
}

export async function createPasswordResetOtp (user, countryCode, phone) {
  const otp = String(crypto.randomInt(100000, 1000000))
  const key = `${countryCode}:${phone}`

  // 先发送再入库：发送失败时抛错，不留下一个用户从未收到的有效 OTP。
  // （若先入库后发送，发送失败的 OTP 会在库里有效 10 分钟，形成可用但未送达的凭证）
  const sent = await deliverOtp({ countryCode, phone, otp })

  await store.set(key, {
    otpHash: hashOtp(otp),
    userId: user.id,
    expiresAt: Date.now() + OTP_TTL_MS
  }, OTP_TTL_MS)

  return { devOtp: sent ? null : otp }
}

export async function consumePasswordResetOtp (countryCode, phone, otp) {
  const key = `${countryCode}:${phone}`
  const row = await store.get(key)
  if (!row || !row.otpHash || row.otpHash !== hashOtp(otp)) return null
  await store.delete(key)
  return row
}

export function getPasswordResetStatus () {
  return { smsConfigured: Boolean(process.env.SMS_WEBHOOK_URL) }
}
