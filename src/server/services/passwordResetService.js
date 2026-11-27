import crypto from 'crypto'
import { createSharedStore } from '../utils/sharedState.js'
import { logger } from '../utils/logger.js'
import { sendSms, SMS_EVENTS } from './smsService.js'

const store = createSharedStore('password-reset-otp')
const OTP_TTL_MS = 10 * 60 * 1000

function hashOtp (otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex')
}

/**
 * 下发 OTP 短信。
 *
 * 第 55 轮：改用**通用短信层**（`smsService.sendSms`）——
 * 之前这段逻辑是"密码重置专用"的（自己拼 URL、自己判断未配置），
 * 与业务事件短信各写一套通道协议，改协议要改两处。
 *
 * 行为保持不变：
 *   - 通道未配置 → 生产抛 503（OTP 是流程的一部分，不能没有）
 *   - 开发/测试环境不真发 → 返回 false，由调用方把 OTP 透出给前端
 *   - 通道报错 → 502
 *
 * `require: true` 表示"发送失败要抛错"（业务事件短信是 false —— 失败只记日志）。
 *
 * 语言不再硬编码英文：按区号推断（+66 泰语 / +86 中文 / 其它英文）——
 * 泰国用户收到英文验证码验证码是很别扭的。
 */
async function deliverOtp ({ countryCode, phone, otp }) {
  let result
  try {
    result = await sendSms({
      phone: `${countryCode}${phone}`,
      countryCode,
      template: SMS_EVENTS.PASSWORD_RESET,
      /**
       * dedupeKey = 本次 OTP：
       *
       * 每次重置都会**生成新 OTP 并覆盖旧的那个**（旧码立刻作废）。
       * 如果这里被冷却挡掉（不发短信），用户手上那条旧短信里的验证码
       * 已经作废、新码又没收到 —— **用户被锁死**，只能等冷却过去再试。
       * 所以每次重置必须是独立的冷却桶。
       */
      dedupeKey: otp,
      vars: { otp, minutes: 10 },
      require: true
    })
  } catch (error) {
    // 通用发送器不知道"这是重置密码"场景 → 由调用方把文案改成用户看得懂的
    if (error?.status === 503) {
      const err = new Error('短信服务未配置，暂时无法重置密码')
      err.status = 503
      throw err
    }
    throw error
  }
  // 开发/测试环境：通道未配置 → sendSms 在 require 模式下会抛 503，
  // 这里转成 false 让调用方把 OTP 透出（与第 55 轮之前的行为一致）
  return result.sent
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
