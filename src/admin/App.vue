<template>
  <div id="app">
    <!-- 致命错误兜底：组件抛错时别白屏 -->
    <!--
      致命错误兜底页。
      ⚠️ 这里**不用 Tailwind 类**：后台没引 Tailwind CSS（main.js 只引 element-plus），
      类名写了也不生效 —— 原来的兜底页是"看起来居中、实际铺满整屏"。
      改用 Element Plus 原语 + 内联样式，保证任何时候都真的能兜住。
    -->
    <div
      v-if="fatalError"
      style="position: fixed; inset: 0; z-index: 100; background: rgba(255,255,255,0.97); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; text-align: center;"
      role="alert"
    >
      <h2 style="font-size: 18px; font-weight: 600; color: #1f2937; margin: 0;">{{ t('common.somethingWentWrong') }}</h2>
      <p style="font-size: 14px; color: #6b7280; max-width: 480px; margin: 0;">{{ t('common.tryAgainHint') }}</p>
      <p v-if="fatalError.message" style="font-size: 12px; color: #9ca3af; max-width: 480px; word-break: break-word; font-family: ui-monospace, monospace; margin: 0;">{{ fatalError.message }}</p>
      <pre v-if="fatalError.stack" style="font-size: 11px; color: #d1d5db; max-width: 480px; max-height: 96px; overflow: auto; white-space: pre-wrap; word-break: break-word; text-align: left; margin: 0;">{{ fatalError.stack }}</pre>
      <el-button type="primary" style="margin-top: 8px;" @click="reloadPage">
        {{ t('common.reload') }}
      </el-button>
    </div>
    <router-view v-slot="{ Component, route }">
      <Transition name="admin-page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </router-view>
  </div>
</template>

<script setup>
import { watch, onMounted, onErrorCaptured } from 'vue'
import { useI18n } from 'vue-i18n'
import { syncDocumentLang } from '../utils/htmlLang.js'
import { useRoute } from 'vue-router'
import { useAdminStore } from './stores/admin.js'
import { fatalError, reportFatalError } from '../utils/fatalError.js'

// 国际化
const { locale, t } = useI18n()
const route = useRoute()

// 更新页面标题
const updatePageTitle = () => {
  const routeName = route.name
  let titleKey = 'title.main'
  
  switch (routeName) {
    case 'Login':
      titleKey = 'title.login'
      break
    case 'Dashboard':
      titleKey = 'title.dashboard'
      break
    case 'Products':
      titleKey = 'title.products'
      break
    case 'Orders':
      titleKey = 'title.orders'
      break
    case 'Users':
      titleKey = 'title.users'
      break
    case 'Operators':
      titleKey = 'title.operators'
      break
    case 'SystemConfig':
      titleKey = 'title.systemConfig'
      break
    case 'OperationLogs':
      titleKey = 'title.operationLogs'
      break
    default:
      titleKey = 'title.main'
  }
  
  document.title = t(titleKey)
}

// 监听路由变化，更新页面标题
watch(() => route.name, () => {
  updatePageTitle()
}, { immediate: true })

// 监听语言变化，更新页面标题 + <html lang>
watch(() => locale.value, () => {
  updatePageTitle()
  syncDocumentLang(locale.value)
})

// 初始化
onMounted(() => {
  // 初始化页面标题
  updatePageTitle()
  /**
   * 同步 <html lang>。
   * 管理端的 locale 是 i18n 创建时从 localStorage 读的（可能直接就是 en-US），
   * 那时 watcher 不会触发（值没"变"）→ lang 会一直停在 index.html 写死的 zh-CN。
   */
  syncDocumentLang(locale.value)

  /**
   * 校验 token 有效性。
   * 此前 isLoggedIn 只看 localStorage 有没有 token 字符串，
   * 过期/被停用的 token 也能先把完整后台 UI 渲染出来（菜单、角色徽标），
   * 直到第一个接口返回 401 才被踢回登录页 —— validateToken 一直是死代码。
   */
  const adminStore = useAdminStore()
  if (adminStore.isLoggedIn) {
    adminStore.validateToken().catch(() => {})
  }
})

onErrorCaptured((err, instance, info) => {
  reportFatalError(err, info)
  return false
})

function reloadPage () {
  window.location.reload()
}
</script>

<style>
#app {
  height: 100vh;
  margin: 0;
  padding: 0;
}

body {
  margin: 0;
  padding: 0;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
}

/* 极简高级风：admin 路由切换 120ms fade，不打扰运营任务流 */
.admin-page-enter-active,
.admin-page-leave-active {
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.admin-page-enter-from,
.admin-page-leave-to {
  opacity: 0;
}

/* 按钮图标与文案间距见 styles/admin-ui-overrides.css（main.js 末尾引入，保证覆盖 EP） */
</style>