<template>
  <div class="login-container">
    <!-- 背景装饰 -->
    <div class="login-bg">
      <div class="bg-shape shape-1"></div>
      <div class="bg-shape shape-2"></div>
      <div class="bg-shape shape-3"></div>
    </div>

    <!-- 登录卡片 -->
    <el-card class="login-card admin-login-card" shadow="always">
      <!-- 语言切换 -->
      <div class="language-switch">
        <el-select 
          v-model="currentLanguage"
          @change="changeLanguage"
          size="small"
          style="width: 80px"
        >
          <!-- 暂不提供泰文界面选项（语言包仍保留） -->
          <!-- <el-option value="th-TH" :label="t('language.thai')">
            <span>ไทย</span>
          </el-option> -->
          <el-option value="zh-CN" :label="t('language.chinese')">
            <span>中文</span>
          </el-option>
          <el-option value="en-US" :label="t('language.english')">
            <span>English</span>
          </el-option>
        </el-select>
      </div>

      <!-- Logo和标题 -->
      <div class="login-header">
        <div class="logo-container">
          <el-icon class="logo-icon" :size="48" color="#409EFF">
            <Lock />
          </el-icon>
        </div>
        <h1 class="login-title">{{ t('login.title') }}</h1>
        <p class="login-subtitle">{{ t('login.subtitle') }}</p>
      </div>

      <!-- 登录表单 -->
      <el-form 
        ref="loginFormRef" 
        :model="loginForm" 
        :rules="formRules" 
        class="login-form"
        size="large"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="loginForm.username"
            :placeholder="t('login.usernamePlaceholder')"
            :prefix-icon="User"
            clearable
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="loginForm.password"
            type="password"
            :placeholder="t('login.passwordPlaceholder')"
            :prefix-icon="Lock"
            show-password
            clearable
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item>
          <div class="login-options">
            <el-checkbox v-model="loginForm.rememberMe">
              {{ t('login.rememberMe') }}
            </el-checkbox>
          </div>
        </el-form-item>

        <el-form-item>
          <el-button 
            type="primary" 
            class="login-button"
            :loading="isLoading"
            @click="handleLogin"
          >
            <template v-if="!isLoading">
              <el-icon class="login-btn-icon"><Right /></el-icon>
            </template>
            {{ isLoading ? t('login.loggingIn') : t('login.loginButton') }}
          </el-button>
        </el-form-item>
      </el-form>


    </el-card>

    <!-- 版权信息 -->
    <div class="footer">
      <p>{{ t('login.copyright') }}</p>
    </div>

    <!-- 滑块验证码弹窗（登录失败次数过多时由后端 428 触发） -->
    <el-dialog
      v-model="captchaDialogVisible"
      :title="t('captcha.title')"
      width="360px"
      style="max-width: 92vw"
      align-center
      destroy-on-close
      :close-on-click-modal="false"
    >
      <div class="captcha-dialog-body">
        <SliderCaptcha ref="captchaRef" @verify="onCaptchaVerify" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { User, Lock, Right, Warning } from '@element-plus/icons-vue'
import { useAdminStore } from '../stores/admin.js'
import SliderCaptcha from '../components/SliderCaptcha.vue'

// 国际化
const { t, locale } = useI18n()

const router = useRouter()
const adminStore = useAdminStore()
const loginFormRef = ref()

// 响应式数据
const isLoading = ref(false)
const currentLanguage = ref(locale.value)

// 滑块验证码（登录失败次数过多时后端返回 428 触发）
const captchaDialogVisible = ref(false)
const captchaRef = ref(null)

// 登录表单
const loginForm = reactive({
  username: '',
  password: '',
  rememberMe: false
})

// 表单验证规则
const formRules = {
  username: [
    { required: true, message: () => t('validation.usernameRequired'), trigger: 'blur' },
    { min: 2, max: 50, message: () => t('validation.usernameLength'), trigger: 'blur' }
  ],
  password: [
    { required: true, message: () => t('validation.passwordRequired'), trigger: 'blur' },
    { min: 6, max: 50, message: () => t('validation.passwordLength'), trigger: 'blur' }
  ]
}

// 处理登录（captcha：滑块验证回调传入的 { token, answer }；普通点击/回车登录不传）
const handleLogin = async (captcha) => {
  if (!loginFormRef.value) return

  // @click/@keyup.enter 会把事件对象作为第一个参数传入，此处仅接受明确的验证码载荷
  const captchaPayload = (
    captcha &&
    typeof captcha === 'object' &&
    typeof captcha.token === 'string' &&
    typeof captcha.answer === 'number'
  ) ? captcha : null

  // 表单验证：失败时 Element 已在表单项标红，静默返回，不误报网络错误
  const valid = await loginFormRef.value.validate().catch(() => false)
  if (!valid) return

  try {
    isLoading.value = true

    const payload = {
      username: loginForm.username.trim(),
      password: loginForm.password
    }
    if (captchaPayload) {
      payload.captcha_token = captchaPayload.token
      payload.captcha_answer = captchaPayload.answer
    }

    const result = await adminStore.login(payload)

    if (result.success) {
      captchaRef.value?.notifySuccess()
      ElMessage.success(t('login.loginSuccess'))

      // 延迟跳转到管理后台首页，同时关闭并重置验证码弹窗
      setTimeout(() => {
        resetCaptchaState()
        router.push('/dashboard')
      }, 800)
      return
    }

    // 428：失败次数过多需滑块验证 / 滑块答案错误（token 一次性，须换新题后重试）
    if (result.status === 428) {
      captchaDialogVisible.value = true
      if (result.code === 'CAPTCHA_INVALID') {
        captchaRef.value?.notifyFailed()
      } else if (captchaRef.value) {
        captchaRef.value.refresh()
      }
      return
    }

    // 不使用后端返回的中文消息，统一使用国际化文本
    ElMessage.error(t('login.loginFailed'))

  } catch (error) {
    console.error('登录失败:', error)
    ElMessage.error(t('login.networkError'))
  } finally {
    isLoading.value = false
  }
}

// 滑块松手回调：取当前 token + 滑块 x（像素，已 Math.round）重试登录
const onCaptchaVerify = (answer) => {
  const token = captchaRef.value?.getToken()
  if (!token) {
    captchaRef.value?.refresh()
    return
  }
  handleLogin({ token, answer })
}

// 关闭并重置验证码状态（destroy-on-close 卸载组件，题目随之作废）
const resetCaptchaState = () => {
  captchaDialogVisible.value = false
}

// 切换语言
const changeLanguage = (lang) => {
  locale.value = lang
  localStorage.setItem('admin-language', lang)
  ElMessage.success(t('language.switchSuccess'))
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow: hidden;
}

/* 极简高级风：登录卡片入场（克制、不打扰） */
@keyframes admin-login-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.admin-login-card {
  animation: admin-login-in 300ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

/* 背景装饰 */
.login-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.bg-shape {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  animation: float 6s ease-in-out infinite;
}

.shape-1 {
  width: 200px;
  height: 200px;
  top: 10%;
  left: 10%;
  animation-delay: 0s;
}

.shape-2 {
  width: 150px;
  height: 150px;
  top: 70%;
  right: 10%;
  animation-delay: 2s;
}

.shape-3 {
  width: 100px;
  height: 100px;
  top: 50%;
  left: 80%;
  animation-delay: 4s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0px) rotate(0deg);
  }
  50% {
    transform: translateY(-20px) rotate(10deg);
  }
}

/* 登录卡片 */
.login-card {
  width: 420px;
  max-width: 90vw;
  position: relative;
  z-index: 2;
  border-radius: 16px;
  overflow: hidden;
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* 语言切换 */
.language-switch {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
}

.login-card :deep(.el-card__body) {
  padding: 40px;
}

/* 登录头部 */
.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-container {
  margin-bottom: 16px;
}

.logo-icon {
  padding: 12px;
  background: linear-gradient(135deg, #409EFF, #67C23A);
  border-radius: 16px;
  color: white;
  box-shadow: 0 8px 25px rgba(64, 158, 255, 0.3);
}

.login-title {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
  margin: 16px 0 8px 0;
  background: linear-gradient(135deg, #409EFF, #67C23A);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.login-subtitle {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

/* 登录表单 */
.login-form {
  margin-bottom: 24px;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 20px;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
}

.login-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.login-button {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  background: linear-gradient(135deg, #409EFF, #67C23A);
  border: none;
  box-shadow: 0 8px 25px rgba(64, 158, 255, 0.3);
  transition: all 0.3s ease;
}

.login-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 35px rgba(64, 158, 255, 0.4);
}

.login-button:active {
  transform: translateY(0);
}

.login-btn-icon {
  margin-left: 8px;
}



/* 版权信息 */
.footer {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  text-align: center;
}

/* 响应式设计 */
@media (max-width: 480px) {
  .login-card {
    width: 95vw;
    margin: 20px;
  }
  
  .login-card :deep(.el-card__body) {
    padding: 24px;
  }
  
  .login-title {
    font-size: 24px;
  }
  
  .shape-1, .shape-2, .shape-3 {
    display: none;
  }
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
  .login-container {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  }
  
  .login-card {
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .login-title {
    color: #ffffff;
  }
  
  .login-subtitle {
    color: #a0a0a0;
  }
}

/* 加载动画优化 */
.login-button.is-loading {
  pointer-events: none;
}

.login-button.is-loading :deep(.el-loading-spinner) {
  margin-top: -8px;
}

/* Element Plus组件样式覆盖 */
.login-form :deep(.el-checkbox__label) {
  color: #606266;
  font-size: 14px;
}

/* 滑块验证码弹窗 */
.captcha-dialog-body {
  display: flex;
  justify-content: center;
  padding: 4px 0 8px;
}

.login-form :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: #409EFF;
  border-color: #409EFF;
}


</style>