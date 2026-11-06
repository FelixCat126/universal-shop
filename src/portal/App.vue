<template>
  <div id="app" class="min-h-screen bg-gray-50">
    <!-- 致命错误兜底：组件抛错时别白屏，给一句说明 + 重试 -->
    <div
      v-if="fatalError"
      class="fixed inset-0 z-[100] bg-white/95 backdrop-blur flex flex-col items-center justify-center gap-4 px-6 text-center"
      role="alert"
    >
      <svg class="h-14 w-14 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
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
    <!-- 顶部导航栏（滚动时 backdrop-blur 渐变） -->
    <header
      class="bg-white/85 backdrop-blur-md border-b sticky top-0 z-40 transition-shadow duration-300"
      :class="{ 'shadow-sm': hasScrolled }"
    >
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between gap-2 sm:gap-4 h-16 min-w-0">
          <!-- 网站标题（窄屏可截断避免顶栏爆裂） -->
          <div class="min-w-0 shrink">
            <router-link :to="{ name: 'Home' }" class="block truncate py-1 text-lg sm:text-xl font-bold text-gray-900 hover:text-blue-600">
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
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap"
                >
                  {{ t('nav.profile') }}
                </router-link>
                <button
                  type="button"
                  @click="handleLogout"
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap"
                >
                  {{ t('nav.logout') }}
                </button>
              </template>
              
              <template v-else>
                <router-link
                  to="/login"
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap"
                >
                  {{ t('nav.login') }}
                </router-link>
                <router-link
                  to="/register"
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap"
                >
                  {{ t('nav.register') }}
                </router-link>
              </template>
            </div>
          </div>
        </div>
      </div>
    </header>
    
    <!-- 路由视图：spring 页面切换（苹果风） -->
    <router-view v-slot="{ Component, route }">
      <Transition name="spring-page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </router-view>

    <footer class="border-t bg-white/80 py-4 sm:py-6 text-center text-xs text-gray-500">
      <!-- 链接加 py-2 扩大触控热区到 32px（移动端易点），视觉尺寸不变 -->
      <div class="flex justify-center gap-1 sm:gap-4">
        <router-link to="/terms" class="inline-block px-2 py-2 hover:text-blue-600">{{ t('legal.termsLink') }}</router-link>
        <span aria-hidden="true" class="self-center">·</span>
        <router-link to="/privacy" class="inline-block px-2 py-2 hover:text-blue-600">{{ t('legal.privacyLink') }}</router-link>
      </div>
    </footer>
    
    <!-- Toast 提示容器 -->
    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, onErrorCaptured } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { fatalError, reportFatalError } from '../utils/fatalError.js'
import { useCartStore } from './stores/cart.js'
import { useUserStore } from './stores/user.js'
import ToastContainer from './components/ui/Toast/ToastContainer.vue'
import i18n from './i18n'
import { fetchAndApplyCurrencyUnit } from '../utils/currencyI18n.js'
import { ensureLocale } from './i18n/index.js'
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
  set: (val) => {
    // 语言包是按需加载的：切到未加载的语言前先把它拉下来，
    // 否则那一瞬间界面会显示成 fallback（中文）或裸 key
    ensureLocale(val).then(() => { locale.value = val })
  }
})

/**
 * 致命错误兜底。
 *
 * 组件渲染抛错时 Vue 默认会把这块界面清空 → 用户看到的是**白屏**，
 * 既不知道出了什么事，也没法继续用。这里把它收住，渲染一个可操作的兜底页。
 */
onErrorCaptured((err, instance, info) => {
  reportFatalError(err, info)
  return false // 不再往上传，避免重复处理
})

function reloadPage () {
  window.location.reload()
}

// 顶栏滚动阴影
const hasScrolled = ref(false)
const onScroll = () => {
  hasScrolled.value = window.scrollY > 8
}

// 卸载时清理
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
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

// 切换语言：**不**动展示币种。
// 语言是给人看的，币种是钱的事 —— 用户手动选过就尊重他，没选过就跟随站点配置的结算币种。
const changeLanguage = (val) => {
  // 用事件带的新值，不要读 currentLanguage.value ——
  // 语言包是异步加载的，setter 还没把 locale 换过去，读到的会是旧值
  const lang = val ?? currentLanguage.value
  localStorage.setItem('language', lang)

  window.dispatchEvent(new CustomEvent('language-changed', {
    detail: { language: lang }
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

/**
 * 切换账号：登录用户 id 变化（而不是登出再登录）时，
 * 上一个账号的服务端购物车行会残留在 store 里 ——
 * 新账号能看到别人的商品名/价格，改数量时还会用新 token 去改旧行 id。
 * 这里在用户 id 变化时重置购物车并重新拉取当前账号的购物车。
 */
watch(() => userStore.user?.id, async (newId, oldId) => {
  if (!newId || !oldId || newId === oldId) return
  try {
    await cartStore.resetForAccountSwitch()
  } catch (error) {
    console.error('❌ 切换账号后购物车重置失败:', error)
  }
})

// 初始化
onMounted(async () => {
  // 顶栏滚动监听
  window.addEventListener('scroll', onScroll, { passive: true })

  // 从localStorage恢复语言设置，默认中文
  const savedLanguage = localStorage.getItem('language') || 'zh-CN'
  localStorage.setItem('language', savedLanguage)

  // 语言包按需加载：恢复的语言若还没下过，先加载再切（避免闪一下 fallback）
  await ensureLocale(savedLanguage)
  locale.value = savedLanguage
  
  try {
    // 两者共用同一份 public 配置（in-flight 去重后实际只发一次请求），并行等待
    await Promise.all([
      fetchAndApplyCurrencyUnit(i18n, ''),
      portalCurrency.loadRates()
    ])
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
/**
 * 移动端高度必须 ≥36px：早期 padding 只有 0.25rem，实测总高 28–30px，
 * 低于触控目标 32px 的下限，手指很难点中（iOS 建议 44px）。
 */
.portal-lang-select {
  font-size: 0.75rem;
  line-height: 1.25rem;
  padding: 0.4375rem 0.375rem;
  min-height: 36px;
  min-width: 4.875rem;
}
.portal-currency-select {
  font-size: 0.75rem;
  line-height: 1.25rem;
  padding: 0.4375rem 0.25rem;
  min-height: 36px;
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