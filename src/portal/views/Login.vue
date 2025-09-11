<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <!-- 头部 -->
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <div class="flex justify-center">
        <div class="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
          <UserIcon class="w-8 h-8 text-white" />
        </div>
      </div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        {{ t('user.login') }}
      </h2>
      <p class="mt-2 text-center text-sm text-gray-600">
        {{ t('user.noAccount') }} 
        <router-link to="/register" class="font-medium text-blue-600 hover:text-blue-500">
          {{ t('user.goToRegister') }}
        </router-link>
      </p>
    </div>

    <!-- 登录表单 -->
    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
        <form class="space-y-6" @submit.prevent="handleLogin">
          <!-- 登录方式切换 -->
          <div class="mb-4">
            <div class="flex rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                @click="loginType = 'phone'"
                :class="[
                  'flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors',
                  loginType === 'phone' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                ]"
              >
                手机号登录
              </button>
              <button
                type="button"
                @click="loginType = 'email'"
                :class="[
                  'flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors',
                  loginType === 'email' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                ]"
              >
                邮箱登录
              </button>
            </div>
          </div>

          <!-- 手机号登录 -->
          <div v-if="loginType === 'phone'">
            <label class="block text-sm font-medium text-gray-700 mb-3">
              {{ t('user.phone') }} <span class="text-red-500">*</span>
            </label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <!-- 国家选择 -->
              <div class="sm:col-span-2">
                <CountrySelector
                  v-model="formData.countryCode"
                  placeholder="选择国家"
                  :error="errors.countryCode"
                />
              </div>
              <!-- 手机号输入 -->
              <div class="sm:col-span-3">
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <span class="text-gray-500 text-sm">{{ formData.countryCode }}</span>
                  </div>
                  <input
                    id="phone"
                    v-model="formData.phone"
                    type="tel"
                    required
                    autocomplete="tel"
                    :maxlength="currentCountry?.phoneLength || 11"
                    class="appearance-none block w-full pl-16 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    :class="{ 'border-red-500': errors.phone }"
                    :placeholder="`请输入${currentCountry?.phoneLength || 11}位手机号`"
                  />
                </div>
                <p v-if="errors.phone" class="mt-1 text-xs text-red-600">{{ errors.phone }}</p>
              </div>
            </div>
          </div>

          <!-- 邮箱登录 -->
          <div v-else>
            <label for="email" class="block text-sm font-medium text-gray-700">
              {{ t('user.email') }}
            </label>
            <div class="mt-1 relative">
              <input
                id="email"
                v-model="formData.email"
                type="email"
                autocomplete="email"
                required
                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-500': errors.email }"
                :placeholder="t('user.emailPlaceholder')"
              />
              <AtSymbolIcon class="absolute right-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
            <p v-if="errors.email" class="mt-2 text-sm text-red-600">
              {{ errors.email }}
            </p>
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
                class="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                :class="{ 'border-red-500': errors.password }"
                :placeholder="t('user.passwordPlaceholder')"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <EyeIcon v-if="!showPassword" class="h-5 w-5 text-gray-400 hover:text-gray-500" />
                <EyeSlashIcon v-else class="h-5 w-5 text-gray-400 hover:text-gray-500" />
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

          <!-- 登录按钮 -->
          <div>
            <button
              type="submit"
              :disabled="isLoading"
              class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
          </div>
        </form>
      </div>
    </div>

    <!-- 返回首页 -->
    <div class="mt-8 text-center">
      <router-link
        to="/"
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
import { validatePhone, getCountryInfo } from '../utils/phoneValidation.js'
import { 
  UserIcon, 
  AtSymbolIcon, 
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
const loginType = ref('phone') // 'phone' 或 'email'

// 表单数据
const formData = ref({
  countryCode: '+86',
  phone: '',
  email: '',
  password: '',
  rememberMe: false
})

// 表单验证错误
const errors = ref({})

// 计算属性
const messageClass = computed(() => {
  return messageType.value === 'success' 
    ? 'bg-green-500 text-white' 
    : 'bg-red-500 text-white'
})

const currentCountry = computed(() => {
  return getCountryInfo(formData.value.countryCode)
})

// 验证是否为邮箱格式
const isEmail = (value) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value)
}

// 表单验证
const validateForm = () => {
  errors.value = {}
  
  if (loginType.value === 'phone') {
    // 手机号登录验证
    if (!formData.value.countryCode) {
      errors.value.countryCode = '请选择国家'
    }
    
    if (!formData.value.phone) {
      errors.value.phone = '请输入手机号'
    } else {
      const phoneValidation = validatePhone(formData.value.phone, formData.value.countryCode)
      if (!phoneValidation.isValid) {
        errors.value.phone = phoneValidation.message
      }
    }
  } else {
    // 邮箱登录验证
    if (!formData.value.email.trim()) {
      errors.value.email = '请输入邮箱地址'
    } else if (!isEmail(formData.value.email)) {
      errors.value.email = '邮箱格式不正确'
    }
  }
  
  // 验证密码
  if (!formData.value.password) {
    errors.value.password = t('validation.passwordRequired')
  } else if (formData.value.password.length < 6) {
    errors.value.password = t('validation.passwordMinLength')
  }
  
  return Object.keys(errors.value).length === 0
}

// 处理登录
const handleLogin = async () => {
  if (!validateForm()) {
    return
  }
  
  try {
    isLoading.value = true
    
    const loginData = {
      password: formData.value.password,
      rememberMe: formData.value.rememberMe
    }
    
    if (loginType.value === 'phone') {
      loginData.country_code = formData.value.countryCode
      loginData.phone = formData.value.phone
    } else {
      loginData.email = formData.value.email.trim()
    }
    
    const result = await userStore.login(loginData)
    
    if (result.success) {
      showMessageToast(t('user.loginSuccess'), 'success')
      
      // 延迟跳转，让用户看到成功消息
      setTimeout(() => {
        // 获取登录前的页面，如果没有则跳转到首页
        const redirectTo = route.query.redirect || '/'
        router.push(redirectTo)
      }, 1000)
      
    } else {
      showMessageToast(result.message || t('user.loginFailed'), 'error')
    }
    
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