<template>
  <div id="app" class="min-h-screen bg-gray-50">
    <!-- 顶部导航栏 -->
    <header class="bg-white shadow-sm border-b">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between gap-2 sm:gap-4 h-16 min-w-0">
          <!-- 网站标题（窄屏可截断避免顶栏爆裂） -->
          <div class="min-w-0 shrink">
            <router-link :to="{ name: 'Home' }" class="block truncate text-lg sm:text-xl font-bold text-gray-900 hover:text-blue-600">
              {{ t('nav.home') }}
            </router-link>
          </div>
          
          <!-- 右侧操作 -->
          <div class="flex items-center shrink-0 gap-1.5 sm:gap-4 min-w-0">
            <!-- 语言 + 币种 -->
            <div class="flex flex-nowrap items-center gap-1 sm:gap-2">
              <span class="text-xs text-gray-500 whitespace-nowrap hidden lg:inline">{{ t('language.label') }}</span>
              <select 
                v-model="currentLanguage"
                @change="changeLanguage"
                class="portal-lang-select border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="zh-CN">{{ t('language.chinese') }}</option>
                <option value="th-TH">{{ t('language.thai') }}</option>
                <option value="en-US">{{ t('language.english') }}</option>
              </select>

              <span class="text-xs text-gray-500 whitespace-nowrap hidden lg:inline">{{ t('exchangeDisplay.currency') }}</span>
              <select 
                :value="portalCurrency.selectedCode"
                class="portal-currency-select border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 tabular-nums"
                @change="onCurrencyChange($event.target.value)"
              >
                <option
                  v-for="opt in portalCurrency.options"
                  :key="opt.code"
                  :value="opt.code"
                >
                  {{ opt.label }}
                </option>
              </select>
            </div>
            
            <!-- 用户操作 -->
            <div class="flex items-center gap-1 sm:gap-2 shrink-0">
              <!-- 购物车 -->
              <router-link 
                to="/cart"
                class="relative p-1.5 sm:p-2 text-gray-400 hover:text-gray-500 shrink-0"
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
                  class="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap"
                >
                  {{ t('nav.profile') }}
                </router-link>
                <button
                  type="button"
                  @click="handleLogout"
                  class="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap"
                >
                  {{ t('nav.logout') }}
                </button>
              </template>
              
              <template v-else>
                <router-link
                  to="/login"
                  class="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap"
                >
                  {{ t('nav.login') }}
                </router-link>
                <router-link
                  to="/register"
                  class="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap"
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
    
    <!-- Toast 提示容器 -->
    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useCartStore } from './stores/cart.js'
import { useUserStore } from './stores/user.js'
import ToastContainer from './components/ui/Toast/ToastContainer.vue'
import i18n from './i18n'
import { fetchAndApplyCurrencyUnit } from '../utils/currencyI18n.js'
import { usePortalCurrencyStore } from './stores/portalCurrency.js'

// 门户端主应用组件已加载

// 国际化
const { locale, t } = useI18n()
const route = useRoute()
const router = useRouter()

// 状态管理
const cartStore = useCartStore()
const userStore = useUserStore()

const portalCurrency = usePortalCurrencyStore()

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

// 切换语言：同步币种为语言默认（见 portalCurrency.store）
const changeLanguage = () => {
  localStorage.setItem('language', currentLanguage.value)

  locale.value = currentLanguage.value

  portalCurrency.applyDefaultForLocale(currentLanguage.value)

  window.dispatchEvent(new CustomEvent('language-changed', {
    detail: { language: currentLanguage.value }
  }))
}

const onCurrencyChange = (code) => {
  portalCurrency.setCurrency(code)
}

// 登出
const handleLogout = async () => {
  try {
    await userStore.logout()
    // 注意：购物车状态清理现在由watch监听器自动处理
    // 强制跳转到门户首页并刷新页面以确保状态重置（须带 /portal/ base，勿用 '/'）
    window.location.href = router.resolve({ name: 'Home' }).href
  } catch (error) {
    console.error('登出失败:', error)
    // 即使出错也要跳转到首页
    window.location.href = router.resolve({ name: 'Home' }).href
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

// 监听用户登录状态变化，处理购物车合并
watch(() => userStore.isLoggedIn, async (newValue, oldValue) => {
  // 从未登录变为已登录：合并游客购物车
  if (!oldValue && newValue) {
    try {
      await cartStore.mergeGuestCartOnLogin()
    } catch (error) {
      console.error('❌ 购物车合并失败:', error)
    }
  }
  
  // 从已登录变为未登录：清理购物车状态
  if (oldValue && !newValue) {
    try {
      cartStore.clearGuestCartOnLogout()
    } catch (error) {
      console.error('❌ 购物车清理失败:', error)
    }
  }
})

// 初始化
onMounted(async () => {
  // 从localStorage恢复语言设置，默认中文
  const savedLanguage = localStorage.getItem('language')
  
  if (savedLanguage) {
    currentLanguage.value = savedLanguage
  } else {
    currentLanguage.value = 'zh-CN'
    localStorage.setItem('language', 'zh-CN')
  }
  
  // 确保vue-i18n的locale与当前语言设置同步
  locale.value = currentLanguage.value
  
  try {
    await fetchAndApplyCurrencyUnit(i18n, '')

    await portalCurrency.loadRates()
    portalCurrency.initFromStorage(locale.value)

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
/* 顶栏语言/币种下拉：窄屏收窄，sm+ 略放宽，下拉展开仍显示完整 option 文案 */
.portal-lang-select {
  font-size: 0.75rem;
  line-height: 1.25rem;
  padding: 0.25rem 0.375rem;
  min-width: 4.875rem;
}
.portal-currency-select {
  font-size: 0.75rem;
  line-height: 1.25rem;
  padding: 0.1875rem 0.25rem;
  min-width: 5.25rem;
  width: 5.25rem;
}
@media (min-width: 640px) {
  .portal-lang-select {
    font-size: 0.875rem;
    padding: 0.375rem 0.5rem;
    min-width: 6.25rem;
  }
  .portal-currency-select {
    font-size: 0.875rem;
    padding: 0.375rem 0.5rem;
    min-width: 6.75rem;
    width: auto;
  }
}
@media (min-width: 768px) {
  .portal-currency-select {
    min-width: 7.25rem;
  }
}
</style>