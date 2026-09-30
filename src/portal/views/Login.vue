<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <!-- 头部 -->
    <div class="ui-slide-up sm:mx-auto sm:w-full sm:max-w-md">
      <div class="flex justify-center">
        <div class="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center ui-scale-in shadow-md">
          <UserIcon class="w-8 h-8 text-white" />
        </div>
      </div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        {{ t('user.login') }}
      </h2>
      <p class="mt-2 text-center text-sm text-gray-600">
        {{ t('user.noAccount') }}
        <router-link to="/register" class="font-medium text-blue-600 hover:text-blue-500 transition-colors">
          {{ t('user.goToRegister') }}
        </router-link>
      </p>
    </div>

    <!-- 登录表单 -->
    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md ui-slide-up" style="--ui-delay: 80ms">
      <div class="bg-white py-8 px-4 shadow-md sm:rounded-lg sm:px-10">
        <form class="space-y-6" @submit.prevent="handleLogin">
          <!-- 手机号登录 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              {{ t('user.phone') }} <span class="text-red-500">*</span>
            </label>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
              <div class="w-full shrink-0 sm:w-[7rem]">
                <CountrySelector
                  v-model="formData.countryCode"
                  :placeholder="t('common.selectCountry')"
                  :error="errors.countryCode"
                />
              </div>
              <div class="min-w-0 flex-1 flex flex-col justify-start">
                <input
                  id="phone"
                  v-model="formData.phone"
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

          <!-- 密码 -->
          <div>
            <label for="password" class="block text-sm font-medium text-gray-700">
              {{ t('user.password') }}
            </label>
            <div class="mt-1 relative">
              <input
                id="password"
                v-model="formData.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="ui-input-focus appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none sm:text-sm"
                :class="{ 'border-red-500': errors.password }"
                :placeholder="t('user.passwordPlaceholder')"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute inset-y-0 right-0 pr-3 flex items-center transition-opacity hover:opacity-70"
              >
                <EyeIcon v-if="!showPassword" class="h-5 w-5 text-gray-400" />
                <EyeSlashIcon v-else class="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <p v-if="errors.password" class="mt-2 text-sm text-red-600">
              {{ errors.password }}
            </p>
            <p class="mt-2 text-xs text-gray-500">
              💡 {{ t('user.initialPasswordHint') }}
            </p>
          </div>

          <!-- 记住登录和忘记密码 -->
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <input
                id="remember-me"
                v-model="formData.rememberMe"
                type="checkbox"
                class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label for="remember-me" class="ml-2 block text-sm text-gray-900">
                {{ t('user.rememberMe') }}
              </label>
            </div>

            <div class="text-sm">
              <a href="#" class="font-medium text-blue-600 hover:text-blue-500">
                {{ t('user.forgotPassword') }}
              </a>
            </div>
          </div>

          <!-- 滑块验证码（登录失败过多时服务端返回 428 触发） -->
          <div v-if="captchaVisible" class="flex justify-center">
            <SliderCaptcha ref="captchaRef" @verify="onCaptchaVerify" />
          </div>

          <!-- 登录按钮 -->
          <div>
            <button
              type="submit"
              :disabled="isLoading"
              class="ui-btn-ripple w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <div v-if="isLoading" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              {{ isLoading ? t('common.loading') : t('user.login') }}
            </button>
          </div>

          <!-- 分割线 -->
          <div class="mt-6">
            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-gray-300" />
              </div>
              <div class="relative flex justify-center text-sm">
                <span class="px-2 bg-white text-gray-500">{{ t('common.or') }}</span>
              </div>
            </div>
          </div>

          <!-- 快速注册链接 -->
          <div class="mt-6">
            <router-link
              to="/register"
              class="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <UserPlusIcon class="h-4 w-4 mr-2" />
              {{ t('user.createAccount') }}
            </router-link>
            <a
              :href="partnerHref"
              class="mt-3 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
            >
              {{ t('user.partnerPortalLink') }}
            </a>
          </div>
        </form>
      </div>
    </div>

    <!-- 返回首页 -->
    <div class="mt-8 text-center">
      <router-link
        :to="{ name: 'Home' }"
        class="inline-flex items-center text-sm text-gray-600 hover:text-gray-500"
      >
        <ArrowLeftIcon class="h-4 w-4 mr-1" />
        {{ t('nav.backToHome') }}
      </router-link>
    </div>

    <!-- 消息提示 -->
    <Transition name="fade">
      <div 
        v-if="showMessage" 
        :class="messageClass"
        class="fixed top-20 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-40"
      >
        {{ message }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '../stores/user.js'
import CountrySelector from '../components/CountrySelector.vue'
import SliderCaptcha from '../components/SliderCaptcha.vue'
import { validatePhone, getCountryInfo, getPhoneLengthRange, getPhoneLengthText } from '../utils/phoneValidation.js'
import { 
  UserIcon, 
  EyeIcon, 
  EyeSlashIcon,
  UserPlusIcon,
  ArrowLeftIcon
} from '@heroicons/vue/24/outline'

// 国际化
const { t } = useI18n()

// 路由和状态
const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

// 响应式数据
const isLoading = ref(false)
const showPassword = ref(false)
const showMessage = ref(false)
const message = ref('')
const messageType = ref('success')
// 表单数据
const formData = ref({
  countryCode: '+66',
  phone: '',
  password: '',
  rememberMe: false
})

// 表单验证错误
const errors = ref({})

// 滑块验证码（428 CAPTCHA_REQUIRED 时展示）
const captchaVisible = ref(false)
const captchaRef = ref(null)

// 计算属性
const messageClass = computed(() => {
  return messageType.value === 'success' 
    ? 'bg-green-500 text-white' 
    : 'bg-red-500 text-white'
})

/** 开发环境门户在 :3001，合作方 dev 在 :3003；生产同源用 /partner/ */
const partnerHref = computed(() => {
  if (typeof window === 'undefined') return '/partner/'
  const { hostname, port } = window.location
  if (hostname === 'localhost' && port === '3001') {
    return 'http://localhost:3003/partner/'
  }
  return '/partner/'
})

const currentCountry = computed(() => {
  const countryInfo = getCountryInfo(formData.value.countryCode)
  if (countryInfo) {
    return {
      ...countryInfo,
      // 翻译国家名称
      name: t(`country.${countryInfo.name}`),
      // phoneLength 为 [min, max] 范围：maxlength 取最大值，提示文案用范围文本
      phoneLengthMax: getPhoneLengthRange(formData.value.countryCode).max,
      phoneLengthText: getPhoneLengthText(formData.value.countryCode)
    }
  }
  return null
})

// 表单验证
const validateForm = () => {
  errors.value = {}
  
  // 国家区号验证
  if (!formData.value.countryCode) {
    errors.value.countryCode = t('validation.countryRequired')
  }
  
  // 手机号验证
  if (!formData.value.phone) {
    errors.value.phone = t('validation.phoneRequired')
  } else {
    const phoneValidation = validatePhone(formData.value.phone, formData.value.countryCode)
    if (!phoneValidation.isValid) {
      errors.value.phone = phoneValidation.message
    }
  }
  
  // 验证密码（仅非空；兼容系统生成的纯数字初始口令等）
  if (!formData.value.password) {
    errors.value.password = t('validation.passwordRequired')
  }
  
  return Object.keys(errors.value).length === 0
}

// 组装登录请求体；captcha 存在时附带 captcha_token / captcha_answer
const buildLoginData = (captcha = null) => {
  const loginData = {
    password: formData.value.password,
    rememberMe: formData.value.rememberMe
  }

  loginData.country_code = formData.value.countryCode
  loginData.phone = formData.value.phone

  if (captcha?.token) {
    loginData.captcha_token = captcha.token
    loginData.captcha_answer = captcha.answer
  }

  return loginData
}

// 统一处理登录结果：成功跳转；428 触发/刷新滑块验证码；其余弹错误提示
const handleLoginResult = (result) => {
  if (result.success) {
    // 隐藏并重置验证码，下次登录重新按 428 触发
    captchaVisible.value = false
    showMessageToast(t('user.loginSuccess'), 'success')

    // 延迟跳转，让用户看到成功消息
    setTimeout(() => {
      // 获取登录前的页面，如果没有则跳转到首页
      const redirectTo = route.query.redirect || '/'
      router.push(redirectTo)
    }, 1000)
    return
  }

  if (result.status === 428) {
    if (result.code === 'CAPTCHA_REQUIRED') {
      // 已展示时保留当前题目（token 未消耗，仍可作答）
      captchaVisible.value = true
    } else if (result.code === 'CAPTCHA_INVALID') {
      // token 一次性，无论对错都已消耗：提示并自动换新题
      captchaVisible.value = true
      captchaRef.value?.showFailed()
    }
    return
  }

  showMessageToast(result.message || t('user.loginFailed'), 'error')
}

// 滑块松手：用同一表单数据 + captcha_token/answer 重试登录
const onCaptchaVerify = async (answer) => {
  const token = captchaRef.value?.token
  if (!token) return

  try {
    isLoading.value = true
    const result = await userStore.login(buildLoginData({ token, answer }))
    if (result.success) {
      captchaRef.value?.showSuccess()
    } else if (!(result.status === 428 && result.code === 'CAPTCHA_INVALID')) {
      // token 一次性（无论对错都已消耗）：密码错误等非验证码失败也先静默换新题，
      // 保证下次拖动用的是未消耗的新 token
      captchaRef.value?.refresh()
    }
    handleLoginResult(result)
  } catch (error) {
    console.error('Login error:', error)
    showMessageToast(t('error.network'), 'error')
  } finally {
    isLoading.value = false
  }
}

// 处理登录
const handleLogin = async () => {
  if (!validateForm()) {
    return
  }

  try {
    isLoading.value = true

    const result = await userStore.login(buildLoginData())
    handleLoginResult(result)

  } catch (error) {
    console.error('Login error:', error)
    showMessageToast(t('error.network'), 'error')
  } finally {
    isLoading.value = false
  }
}

// 显示消息提示
const showMessageToast = (msg, type = 'success') => {
  message.value = msg
  messageType.value = type
  showMessage.value = true
  
  setTimeout(() => {
    showMessage.value = false
  }, 3000)
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>