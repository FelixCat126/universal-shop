<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <!-- 头部 -->
    <div class="ui-slide-up sm:mx-auto sm:w-full sm:max-w-md">
      <div class="flex justify-center">
        <div class="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center ui-scale-in shadow-md">
          <KeyIcon class="w-8 h-8 text-white" />
        </div>
      </div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        {{ t('user.forgotPassword') }}
      </h2>
      <p class="mt-2 text-center text-sm text-gray-600">
        {{ t('user.forgotPasswordHint') }}
      </p>
    </div>

    <!-- 表单 -->
    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md ui-slide-up" style="--ui-delay: 80ms">
      <div class="bg-white py-8 px-4 shadow-md sm:rounded-lg sm:px-10">
        <form class="space-y-6" @submit.prevent="handleSubmit">
          <!-- 手机号 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              {{ t('user.phone') }} <span class="text-red-500">*</span>
            </label>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
              <div class="w-full shrink-0 sm:w-[7rem]">
                <CountrySelector
                  v-model="form.countryCode"
                  :placeholder="t('common.selectCountry')"
                  :error="errors.countryCode"
                />
              </div>
              <div class="min-w-0 flex-1 flex flex-col justify-start">
                <input
                  id="reset-phone"
                  v-model="form.phone"
                  type="tel"
                  required
                  autocomplete="tel"
                  :maxlength="currentCountry?.phoneLengthMax || 11"
                  class="ui-input-focus block w-full h-10 px-3 border border-gray-300 rounded-md text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none"
                  :class="{ 'border-red-500': errors.phone }"
                  :placeholder="t('user.phoneInputPlaceholder', { length: currentCountry?.phoneLengthText || '11' })"
                />
                <p v-if="errors.phone" class="mt-1 text-xs text-red-600">{{ errors.phone }}</p>
              </div>
            </div>
          </div>

          <!-- 滑块验证码 -->
          <div class="flex justify-center">
            <SliderCaptcha ref="captchaRef" @verify="onCaptchaVerify" />
          </div>

          <!-- 验证码 + 新密码（发送成功后才展开） -->
          <template v-if="otpSent">
            <div>
              <label for="reset-otp" class="block text-sm font-medium text-gray-700">
                {{ t('user.otpCode') }} <span class="text-red-500">*</span>
              </label>
              <div class="mt-1 flex gap-2">
                <input
                  id="reset-otp"
                  v-model="form.otp"
                  type="text"
                  inputmode="numeric"
                  required
                  maxlength="8"
                  class="ui-input-focus block w-full h-10 px-3 border border-gray-300 rounded-md text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none"
                  :class="{ 'border-red-500': errors.otp }"
                  :placeholder="t('user.otpPlaceholder')"
                />
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  :disabled="resendCooldown > 0"
                  @click="resendOtp"
                >
                  {{ resendCooldown > 0 ? `${resendCooldown}s` : t('user.resendOtp') }}
                </button>
              </div>
              <p v-if="errors.otp" class="mt-1 text-xs text-red-600">{{ errors.otp }}</p>
            </div>

            <div>
              <label for="reset-password" class="block text-sm font-medium text-gray-700">
                {{ t('user.newPassword') }} <span class="text-red-500">*</span>
              </label>
              <div class="mt-1 relative">
                <input
                  id="reset-password"
                  v-model="form.newPassword"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  required
                  class="ui-input-focus appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none text-sm"
                  :class="{ 'border-red-500': errors.newPassword }"
                  :placeholder="t('user.newPasswordPlaceholder')"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                  :aria-label="t('user.togglePassword')"
                  @click="showPassword = !showPassword"
                >
                  <EyeIcon v-if="showPassword" class="w-5 h-5" />
                  <EyeSlashIcon v-else class="w-5 h-5" />
                </button>
              </div>
              <p v-if="errors.newPassword" class="mt-1 text-xs text-red-600">{{ errors.newPassword }}</p>
              <p class="mt-1 text-xs text-gray-500">{{ t('user.passwordPolicyHint') }}</p>
            </div>
          </template>

            <!-- 错误 / 成功提示 -->
            <p v-if="!smsConfigured" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {{ t('user.smsNotConfigured') }}
            </p>
            <p v-if="errorMessage" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {{ errorMessage }}
            </p>
          <p v-if="successMessage" class="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {{ successMessage }}
          </p>

          <button
            type="submit"
            :disabled="submitting || !smsConfigured"
            class="ui-btn-ripple w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {{ submitting ? t('common.loading') : (otpSent ? t('user.resetPassword') : t('user.sendOtp')) }}
          </button>
        </form>
      </div>
    </div>

    <div class="mt-6 text-center">
      <router-link
        to="/login"
        class="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeftIcon class="w-4 h-4 mr-1" />
        {{ t('common.back') }}
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  KeyIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowLeftIcon
} from '@heroicons/vue/24/outline'
import api from '../api/index.js'
import CountrySelector from '../components/CountrySelector.vue'
import SliderCaptcha from '../components/SliderCaptcha.vue'
import { useToast } from '../composables/useToast.js'
import { validatePhoneI18n, getCountryInfo, getPhoneLengthRange, getPhoneLengthText } from '../utils/phoneValidation.js'
import { describePasswordPolicyFailure } from '../utils/passwordPolicy.js'
import { loadPublicConfig } from '../../utils/publicConfig.js'

const { t } = useI18n()
const router = useRouter()
const { error: showToastError, success: showToastSuccess } = useToast()

const form = reactive({
  countryCode: '+66',
  phone: '',
  otp: '',
  newPassword: ''
})
const errors = reactive({ countryCode: '', phone: '', otp: '', newPassword: '' })
const showPassword = ref(false)
const submitting = ref(false)
const otpSent = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const captchaRef = ref(null)
const resendCooldown = ref(0)
// 短信通道未部署时整个流程不可用：入口与直达 URL 都要拦住
const smsConfigured = ref(false)

let cooldownTimer = null

const currentCountry = computed(() => {
  const info = getCountryInfo(form.countryCode)
  if (!info) return null
  return {
    ...info,
    name: t(`country.${info.name}`),
    phoneLengthMax: getPhoneLengthRange(form.countryCode).max,
    phoneLengthText: getPhoneLengthText(form.countryCode)
  }
})

const clearErrors = () => {
  errors.countryCode = ''
  errors.phone = ''
  errors.otp = ''
  errors.newPassword = ''
  errorMessage.value = ''
  successMessage.value = ''
}

const startCooldown = () => {
  resendCooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

const validatePhone = () => {
  const result = validatePhoneI18n(form.phone, form.countryCode, t)
  if (!result.isValid) {
    errors.phone = result.message
    return false
  }
  errors.phone = ''
  return true
}

/** 滑块验证通过 → 拿到 token/answer，发起 OTP 请求 */
const onCaptchaVerify = async (answer) => {
  const token = captchaRef.value?.token
  if (!token) return
  submitting.value = true
  clearErrors()
  try {
    const { data } = await api.post('/users/forgot-password', {
      country_code: form.countryCode,
      phone: form.phone,
      captcha_token: token,
      captcha_answer: answer
    })
    if (data?.success) {
      otpSent.value = true
      successMessage.value = data.message || t('user.otpSent')
      showToastSuccess(data.message || t('user.otpSent'))
      captchaRef.value?.showSuccess()
      startCooldown()
      // 开发环境后端会回传 dev_otp，便于本地验证完整流程
      if (data.dev_otp) {
        form.otp = String(data.dev_otp)
        successMessage.value += ` (dev: ${data.dev_otp})`
      }
    } else {
      errorMessage.value = data?.message || t('common.error')
      captchaRef.value?.showFailed()
      captchaRef.value?.refresh()
    }
  } catch (err) {
    const status = err.response?.status
    const data = err.response?.data
    if (status === 428) {
      // 验证码无效/过期：重置滑块让用户重来
      errorMessage.value = data?.message || t('user.captchaInvalid')
      captchaRef.value?.showFailed()
      captchaRef.value?.refresh()
    } else {
      errorMessage.value = data?.message || t('common.error')
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 重发验证码：滑块 token 是一次性消费，服务端核销后不可复用，
 * 因此重发必须让用户重新拖动滑块（不能静默用旧 token 重试）
 */
const resendOtp = () => {
  if (resendCooldown.value > 0) return
  if (!validatePhone()) return
  otpSent.value = false
  form.otp = ''
  errorMessage.value = ''
  successMessage.value = t('user.otpResendHint')
  captchaRef.value?.refresh()
}

const handleSubmit = async () => {
  clearErrors()

  if (!otpSent.value) {
    // 未发送验证码：校验手机号后等滑块触发
    if (!validatePhone()) return
    if (!captchaRef.value) {
      errorMessage.value = t('user.captchaInvalid')
      return
    }
    captchaRef.value?.showFailed()
    return
  }

  if (!form.otp) {
    errors.otp = t('user.otpRequired')
    return
  }
  const policy = describePasswordPolicyFailure(form.newPassword)
  if (policy) {
    const keyMap = {
      short: 'validation.passwordMinLength',
      digit: 'validation.passwordNeedsDigit',
      letter: 'validation.passwordNeedsLetter'
    }
    errors.newPassword = t(keyMap[policy] || 'validation.password')
    return
  }

  submitting.value = true
  try {
    const { data } = await api.post('/users/reset-password', {
      country_code: form.countryCode,
      phone: form.phone,
      otp: form.otp,
      new_password: form.newPassword
    })
    if (data?.success) {
      showToastSuccess(data.message || t('user.passwordResetOk'))
      router.push('/login')
    } else {
      errors.otp = data?.message || t('user.otpInvalid')
    }
  } catch (err) {
    const data = err.response?.data
    const msg = data?.message || t('common.error')
    // 验证码类错误落在 otp 字段上，密码策略类落在 newPassword 上
    if (/验证码|otp/i.test(msg)) errors.otp = msg
    else errors.newPassword = msg
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  // 默认区号：优先浏览器推断，其次泰国
  try {
    const region = navigator.language?.split('-')[1]
    const info = getCountryInfo(`+${region}`)
    if (info) form.countryCode = `+${region}`
  } catch {
    form.countryCode = '+66'
  }
  // 短信通道是否可用（公开配置下发 sms_configured）
  try {
    const cfg = await loadPublicConfig()
    smsConfigured.value = Boolean(cfg?.sms_configured)
  } catch {
    smsConfigured.value = false
  }
})

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>
