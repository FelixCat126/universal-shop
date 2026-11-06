<template>
  <div id="app">
    <!-- 致命错误兜底：组件抛错时别白屏 -->
    <div
      v-if="fatalError"
      class="fixed inset-0 z-[100] bg-white/95 backdrop-blur flex flex-col items-center justify-center gap-4 px-6 text-center"
      role="alert"
    >
      <h2 class="text-lg font-semibold text-gray-900">{{ t('common.somethingWentWrong') }}</h2>
      <p class="text-sm text-gray-500 max-w-md">{{ t('common.tryAgainHint') }}</p>
      <p v-if="fatalError.message" class="text-xs text-gray-400 max-w-md break-words font-mono">{{ fatalError.message }}</p>
      <pre v-if="fatalError.stack" class="text-[10px] text-gray-300 max-w-md max-h-24 overflow-auto whitespace-pre-wrap break-words text-left">{{ fatalError.stack }}</pre>
      <button
        type="button"
        class="mt-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        @click="reloadPage"
      >
        {{ t('common.reload') }}
      </button>
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

// 监听语言变化，更新页面标题
watch(() => locale.value, () => {
  updatePageTitle()
})

// 初始化
onMounted(() => {
  // 初始化页面标题
  updatePageTitle()

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