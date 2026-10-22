import User from '../models/User.js'
import { createPasswordResetOtp, consumePasswordResetOtp } from '../services/passwordResetService.js'
import { verifyCaptcha } from '../utils/captcha.js'
import { assertPasswordPolicy } from '../utils/passwordPolicy.js'
import { logger } from '../utils/logger.js'

const SUPPORTED = new Set(['+86', '+66', '+60'])

function validatePhone (countryCode, phone) {
  if (!SUPPORTED.has(countryCode) || !/^\d+$/.test(phone || '')) return false
  if (countryCode === '+86') return /^1[3-9]\d{9}$/.test(phone)
  if (countryCode === '+66') return /^[689]\d{8,9}$/.test(phone)
  if (countryCode === '+60') return /^1\d{8,9}$/.test(phone)
  return false
}

class PasswordResetController {
  static async forgotPassword (req, res) {
    try {
      const { country_code: countryCode = '+66', phone, captcha_token: token, captcha_answer: answer } = req.body || {}
      if (!SUPPORTED.has(countryCode) || !validatePhone(countryCode, String(phone || ''))) {
        return res.status(400).json({ success: false, message: '请提供有效的国家区号与手机号' })
      }
      if (!token || answer === undefined) {
        return res.status(428).json({ success: false, code: 'CAPTCHA_REQUIRED', message: '请先完成滑块验证码' })
      }
      if (!(await verifyCaptcha(token, answer))) {
        return res.status(428).json({ success: false, code: 'CAPTCHA_INVALID', message: '验证码错误或已过期' })
      }

      const user = await User.findOne({ where: { country_code: countryCode, phone } })
      // 无论账号是否存在都返回统一提示，防手机号枚举
      let devOtp = null
      if (user && user.is_active) {
        const result = await createPasswordResetOtp(user, countryCode, phone)
        devOtp = result.devOtp
      }

      const payload = {
        success: true,
        message: '如果该手机号可以重置密码，验证码将发送到您的手机（10 分钟内有效）'
      }
      if (process.env.NODE_ENV !== 'production') payload.dev_otp = devOtp
      return res.json(payload)
    } catch (error) {
      logger.error('forgotPassword 失败', { err: error?.message, stack: error?.stack })
      const status = error.status || 500
      return res.status(status).json({
        success: false,
        message: status === 500 ? '重置密码暂时不可用' : error.message,
        code: status === 500 ? 'INTERNAL_SERVER_ERROR' : undefined
      })
    }
  }

  static async resetPassword (req, res) {
    try {
      const { country_code: countryCode = '+66', phone, otp, new_password: newPassword } = req.body || {}
      if (!SUPPORTED.has(countryCode) || !validatePhone(countryCode, String(phone || ''))) {
        return res.status(400).json({ success: false, message: '请提供有效的国家区号与手机号' })
      }
      if (!otp || !newPassword) {
        return res.status(400).json({ success: false, message: '请输入验证码和新密码' })
      }
      const policy = assertPasswordPolicy(String(newPassword))
      if (!policy.ok) {
        return res.status(400).json({ success: false, message: policy.message })
      }

      const row = await consumePasswordResetOtp(countryCode, phone, String(otp))
      if (!row) {
        return res.status(400).json({ success: false, message: '验证码错误或已过期，请重新获取' })
      }

      const user = await User.findByPk(row.userId)
      if (!user || !user.is_active) {
        return res.status(400).json({ success: false, message: '账号不可用' })
      }
      user.password = String(newPassword)
      user.must_reset_password = false
      user.token_version = (Number(user.token_version) || 0) + 1
      await user.save()

      const { invalidateAuthCache } = await import('../middlewares/authMiddleware.js')
      await invalidateAuthCache(user.id)

      return res.json({ success: true, message: '密码重置成功，请使用新密码登录' })
    } catch (error) {
      logger.error('resetPassword 失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '重置密码失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }
}

export default PasswordResetController
