<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        {{ t('user.createAccount') }}
      </h2>
      <p class="mt-2 text-center text-sm text-gray-600">
        {{ t('common.or') }} 
        <router-link to="/login" class="font-medium text-blue-600 hover:text-blue-500">
          {{ t('user.loginExistingAccount') }}
        </router-link>
      </p>
    </div>

    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
        <form @submit.prevent="handleSubmit" class="space-y-6">
          <!-- 昵称 -->
          <div>
            <label for="nickname" class="block text-sm font-medium text-gray-700">
              {{ t('user.nickname') }} <span class="text-red-500">*</span>
            </label>
            <div class="mt-1">
              <input
                id="nickname"
                v-model="form.nickname"
                type="text"
                required
                maxlength="50"
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-300': errors.nickname }"
                :placeholder="t('user.nicknamePlaceholder')"
              >
              <p v-if="errors.nickname" class="mt-1 text-xs text-red-600">{{ errors.nickname }}</p>
            </div>
          </div>

          <!-- 手机号 -->
          <div>
            <label for="phone" class="block text-sm font-medium text-gray-700">
              {{ t('user.phone') }} <span class="text-red-500">*</span>
            </label>
            <div class="mt-1">
              <input
                id="phone"
                v-model="form.phone"
                type="tel"
                required
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-300': errors.phone }"
                :placeholder="t('user.phonePlaceholder')"
              >
              <p v-if="errors.phone" class="mt-1 text-xs text-red-600">{{ errors.phone }}</p>
              <p class="mt-1 text-xs text-gray-500">{{ t('user.phoneHint') }}</p>
            </div>
          </div>

          <!-- 邮箱 -->
          <div>
            <label for="email" class="block text-sm font-medium text-gray-700">
              {{ t('user.email') }}（{{ t('common.optional') }}）
            </label>
            <div class="mt-1">
              <input
                id="email"
                v-model="form.email"
                type="email"
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-300': errors.email }"
                :placeholder="t('user.emailPlaceholder')"
              >
              <p v-if="errors.phone" class="mt-1 text-xs text-red-600">{{ errors.phone }}</p>
            </div>
          </div>

          <!-- 密码 -->
          <div>
            <label for="password" class="block text-sm font-medium text-gray-700">
              {{ t('user.password') }} <span class="text-red-500">*</span>
            </label>
            <div class="mt-1">
              <input
                id="password"
                v-model="form.password"
                type="password"
                required
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-300': errors.password }"
                :placeholder="t('user.passwordPlaceholder')"
              >
              <p v-if="errors.password" class="mt-1 text-xs text-red-600">{{ errors.password }}</p>
            </div>
          </div>

          <!-- 确认密码 -->
          <div>
            <label for="confirmPassword" class="block text-sm font-medium text-gray-700">
              {{ t('user.confirmPassword') }} <span class="text-red-500">*</span>
            </label>
            <div class="mt-1">
              <input
                id="confirmPassword"
                v-model="form.confirmPassword"
                type="password"
                required
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-300': errors.confirmPassword }"
                :placeholder="t('user.confirmPasswordPlaceholder')"
              >
              <p v-if="errors.confirmPassword" class="mt-1 text-xs text-red-600">{{ errors.confirmPassword }}</p>
            </div>
          </div>

          <!-- 推荐码 -->
          <div>
            <label for="referralCode" class="block text-sm font-medium text-gray-700">
              {{ t('referral.code') }}
            </label>
            <div class="mt-1">
              <input
                id="referralCode"
                v-model="form.referralCode"
                type="text"
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :placeholder="t('referral.placeholder')"
              >
              <p class="mt-1 text-xs text-gray-500">{{ t('referral.hint') }}</p>
            </div>
          </div>

          <!-- 提交按钮 -->
          <div>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg v-if="isSubmitting" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ isSubmitting ? t('common.loading') : t('user.createAccount') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { userAPI } from '../api/users.js'

// 国际化
const { t } = useI18n()

const router = useRouter()

// 表单数据
const form = reactive({
  nickname: '',
  phone: '',
  email: '',
  password: '',
  confirmPassword: '',
  referralCode: ''
})

// 表单错误
const errors = ref({})

// 状态
const isSubmitting = ref(false)

// 表单验证
const validateForm = () => {
  const newErrors = {}

  // 昵称验证
  if (!form.nickname) {
    newErrors.nickname = t('validation.nicknameRequired')
  } else if (form.nickname.length > 50) {
    newErrors.nickname = t('validation.nicknameMaxLength')
  }

  // 手机号验证（必填）
  if (!form.phone) {
    newErrors.phone = t('validation.phoneRequired')
  } else if (!/^[1-9]\d{9,}$/.test(form.phone)) {
    newErrors.phone = t('validation.phoneFormat')
  }

  // 邮箱验证（可选）
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    newErrors.email = t('validation.email')
  }

  // 密码验证
  if (!form.password) {
    newErrors.password = t('validation.passwordRequired')
  } else if (form.password.length < 6) {
    newErrors.password = t('validation.passwordMinLength')
  }

  // 确认密码验证
  if (!form.confirmPassword) {
    newErrors.confirmPassword = t('validation.confirmPasswordRequired')
  } else if (form.password !== form.confirmPassword) {
    newErrors.confirmPassword = t('validation.confirmPassword')
  }

  errors.value = newErrors
  return Object.keys(newErrors).length === 0
}

// 提交表单
const handleSubmit = async () => {
  if (!validateForm()) {
    return
  }

  try {
    isSubmitting.value = true

    const userData = {
      nickname: form.nickname,
      phone: form.phone,
      email: form.email || undefined,
      password: form.password,
      referral_code: form.referralCode || undefined
    }

    const response = await userAPI.register(userData)

    if (response.data.success) {
      // 保存用户信息和token
      localStorage.setItem('token', response.data.data.token)
      localStorage.setItem('user', JSON.stringify(response.data.data.user))
      
      alert(t('user.registerSuccess'))
      
      // 跳转到首页
      router.push('/')
    }
  } catch (error) {
    console.error('注册失败:', error)
    
    if (error.response?.data?.message) {
      alert(t('user.registerFailed') + ': ' + error.response.data.message)
    } else {
      alert(t('user.registerFailed') + '，' + t('error.tryLater'))
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
/* 基础样式 */
</style>