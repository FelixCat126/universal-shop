<template>
  <div id="app" class="min-h-screen bg-gray-50">
    <!-- 顶部导航栏 -->
    <header class="bg-white shadow-sm border-b">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <!-- 网站标题 -->
          <div class="flex items-center">
            <router-link to="/" class="text-xl font-bold text-gray-900 hover:text-blue-600">
              {{ t('nav.home') }}
            </router-link>
          </div>
          
          <!-- 右侧操作 -->
          <div class="flex items-center space-x-4">
            <!-- 语言切换 -->
            <select 
              v-model="currentLanguage"
              @change="changeLanguage"
              class="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="zh-CN">{{ t('language.chinese') }}</option>
              <option value="th-TH">{{ t('language.thai') }}</option>
              <option value="en-US">{{ t('language.english') }}</option>
            </select>
            
            <!-- 用户操作 -->
            <div class="flex items-center space-x-2">
              <!-- 购物车 -->
              <router-link 
                to="/cart"
                class="relative p-2 text-gray-400 hover:text-gray-500"
              >
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-1.5 1.5M7 13v6a2 2 0 002 2h6a2 2 0 002-2v-6" />
                </svg>
                <span 
                  v-if="cartStore.itemCount > 0"
                  class="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
                >
                  {{ cartStore.itemCount }}
                </span>
              </router-link>
              
              <!-- 根据登录状态显示不同按钮 -->
              <template v-if="userStore.isAuthenticated">
                <router-link
                  to="/profile"
                  class="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {{ t('nav.profile') }}
                </router-link>
                <button
                  @click="handleLogout"
                  class="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {{ t('nav.logout') }}
                </button>
              </template>
              
              <template v-else>
                <router-link
                  to="/login"
                  class="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {{ t('nav.login') }}
                </router-link>
                <router-link
                  to="/register"
                  class="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  {{ t('nav.register') }}
                </router-link>
              </template>
            </div>
          </div>
        </div>
      </div>
    </header>
    
    <!-- 路由视图 -->
    <router-view />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useCartStore } from './stores/cart.js'
import { useUserStore } from './stores/user.js'

// 门户端主应用组件已加载

// 国际化
const { locale, t } = useI18n()
const route = useRoute()

// 状态管理
const cartStore = useCartStore()
const userStore = useUserStore()

// 响应式数据
const currentLanguage = computed({
  get: () => locale.value,
  set: (val) => { locale.value = val }
})

// 更新页面标题
const updatePageTitle = () => {
  const routeName = route.name
  let titleKey = 'title.main'
  
  switch (routeName) {
    case 'Home':
      titleKey = 'title.home'
      break
    case 'Products':
      titleKey = 'title.products'
      break
    case 'Cart':
      titleKey = 'title.cart'
      break
    case 'Profile':
      titleKey = 'title.profile'
      break
    case 'Orders':
      titleKey = 'title.orders'
      break
    default:
      titleKey = 'title.main'
  }
  
  document.title = t(titleKey)
}

// 切换语言
const changeLanguage = () => {
  localStorage.setItem('language', currentLanguage.value)
  // 触发自定义事件，通知其他组件语言变化
  window.dispatchEvent(new CustomEvent('language-changed', { 
    detail: { language: currentLanguage.value } 
  }))
  // vue-i18n会自动响应locale的变化
}

// 登出
const handleLogout = async () => {
  try {
    await userStore.logout()
    // 清空购物车状态（登出后切换到游客模式）
    await cartStore.loadCart()
    // 强制跳转到首页并刷新页面以确保状态重置
    window.location.href = '/'
  } catch (error) {
    console.error('登出失败:', error)
    // 即使出错也要跳转到首页
    window.location.href = '/'
  }
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
onMounted(async () => {
  // 从localStorage恢复语言设置，默认泰文
  const savedLanguage = localStorage.getItem('language')
  if (savedLanguage) {
    currentLanguage.value = savedLanguage
  } else {
    currentLanguage.value = 'th-TH'
    localStorage.setItem('language', 'th-TH')
  }
  
  try {
    // 检查用户认证状态
    await userStore.checkAuth()
    
    // 初始化购物车数据
    await cartStore.loadCart()
    
    // 初始化页面标题
    updatePageTitle()
  } catch (error) {
    console.error('初始化失败:', error)
  }
})
</script>

<style scoped>
/* 基础样式 */
</style>