<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script setup>
import { watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

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
})
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
</style>