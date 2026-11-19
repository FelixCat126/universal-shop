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
    <!-- 需要设置密码：横幅提示（不打断当前流程） -->
    <div
      v-if="userStore.mustResetPassword"
      class="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex flex-wrap items-center gap-2 justify-between"
      role="alert"
    >
      <span class="text-sm text-amber-900">{{ t('profile.passwordChangeNotice') }}</span>
      <button
        type="button"
        class="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700"
        @click="goSetPassword"
      >
        {{ t('profile.changePassword') }}
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
            <!--
              语言 + 币种：sm+ 留在顶栏，**移动端下沉到页脚**。
              原因（实测 390px 视口）：顶栏右区本来就占 306px，
              再加上触控热区提到 44px（购物车图标 +8px），
              已登录态还有「个人中心 + 退出」两个按钮 → 总宽会溢出容器约 13px。
              移动端把这两个次要设置放到页脚，顶栏只留导航与账号操作。
            -->
            <div class="hidden sm:flex flex-nowrap items-center gap-1 sm:gap-2">
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
                class="relative p-1.5 sm:p-2 text-gray-400 hover:text-gray-500 shrink-0 inline-flex items-center justify-center h-11 w-11 sm:h-auto sm:w-auto"
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
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap inline-flex items-center justify-center min-h-[44px] sm:min-h-0"
                >
                  {{ t('nav.profile') }}
                </router-link>
                <button
                  type="button"
                  @click="handleLogout"
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap inline-flex items-center justify-center min-h-[44px] sm:min-h-0"
                >
                  {{ t('nav.logout') }}
                </button>
              </template>
              
              <template v-else>
                <router-link
                  to="/login"
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 whitespace-nowrap inline-flex items-center justify-center min-h-[44px] sm:min-h-0"
                >
                  {{ t('nav.login') }}
                </router-link>
                <router-link
                  to="/register"
                  class="px-2.5 py-2 sm:px-3 text-xs sm:text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap inline-flex items-center justify-center min-h-[44px] sm:min-h-0"
                >
                  {{ t('nav.register') }}
                </router-link>
              </template>
            </div>
          </div>
        </div>
      </div>
    </header>
    
    <!--
      路由视图：**无空档**的页面切换。

      原来用 `mode="out-in"` + 位移缩放动画（spring-page）：
        旧页向上缩小淡出 → 旧元素移除 → 新页从下方弹上来
      中间既没有旧页也没有新页（空白帧），加上位移/缩放本身，
      人眼读到的就是"页面在跳 / 在刷新"。

      现在：
        - 去掉 out-in → 新旧**同时在场**，新页在上层盖住旧页 → 永不空白
        - 只做 opacity（不做位移/缩放）→ 不再"跳"
        - 离开元素 absolute 定位 → 不占文档流 → 页面高度不因切换而塌
    -->
    <div class="route-stage">
      <router-view v-slot="{ Component, route }">
        <Transition name="page-fade">
          <component :is="Component" :key="route.path" class="page-shell" />
        </Transition>
      </router-view>
    </div>

    <footer class="border-t bg-white/80 py-4 sm:py-6 text-center text-xs text-gray-500">
      <!--
        移动端专属：语言 / 币种切换（桌面在顶栏，移动端下沉到这里 ——
        顶栏在 390px 下放不下，见上方顶栏注释）。
        保留完整入口，不能因为「藏起来」而让功能消失。
      -->
      <div class="sm:hidden mb-3 flex items-center justify-center gap-2">
        <select
          v-model="currentLanguage"
          @change="changeLanguage"
          :aria-label="t('language.label')"
          class="portal-lang-select border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="zh-CN">{{ t('language.chinese') }}</option>
          <option value="th-TH">{{ t('language.thai') }}</option>
          <option value="en-US">{{ t('language.english') }}</option>
        </select>
        <select
          :value="portalCurrency.selectedCode"
          :aria-label="t('exchangeDisplay.currency')"
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

      <!-- 链接加 min-h-[44px] 扩大触控热区（移动端易点），视觉尺寸不变 -->
      <div class="flex justify-center gap-1 sm:gap-4">
        <router-link to="/terms" class="inline-flex items-center min-h-[44px] px-2 hover:text-blue-600">{{ t('legal.termsLink') }}</router-link>
        <span aria-hidden="true" class="self-center">·</span>
        <router-link to="/privacy" class="inline-flex items-center min-h-[44px] px-2 hover:text-blue-600">{{ t('legal.privacyLink') }}</router-link>
      </div>
    </footer>
    
    <!-- Toast 提示容器 -->
    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, onErrorCaptured } from 'vue'
import { useI18n } from 'vue-i18n'
import { syncDocumentLang } from '../utils/htmlLang.js'
import { useRoute, useRouter } from 'vue-router'
import { fatalError, reportFatalError } from '../utils/fatalError.js'
import { useRoutePrefetch } from '../utils/routePrefetch.js'
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
// 路由 chunk 预取：鼠标移到链接上就把该页代码下载好，切换时不再白屏
useRoutePrefetch(router)

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
  window.removeEventListener('app:password-change-required', onPasswordChangeRequired)
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

// 监听语言变化，更新页面标题 + <html lang>
watch(() => locale.value, () => {
  updatePageTitle()
  syncDocumentLang(locale.value)
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
 * 首次登录必须改密 → 直接把人送到改密弹窗。
 *
 * 账号来源：游客自动注册、运营批量导入客户 —— 密码都是系统随机生成的，
 * 用户自己都不知道。不引导他改密，他就一直用着一个自己都不知道的密码。
 * 标志位 must_reset_password 一直存在，但**前端从来没读过它**。
 */
/**
 * 服务端在账号级操作上返回 PASSWORD_CHANGE_REQUIRED → 直接把改密弹窗叫出来。
 * （横幅只是提示；真正被拦住的时候要把用户送到能解决的地方。）
 */
const onPasswordChangeRequired = () => {
  if (route.query.force === 'password') return
  router.push({ path: '/profile', query: { tab: 'profile', force: 'password' } })
}

/**
 * 需要改密 → 顶部横幅提示 + 一个按钮。
 *
 * 为什么**不自动跳转**：
 *   登录后往往紧接着有应用自己的导航（游客下单完 → /profile?tab=orders 看订单）。
 *   自动跳转会跟它**抢路由**，把用户从"刚下的订单"拽走 ——
 *   那个 E2E 就是这么被我的自动跳转打断的（实测：下单后被带到改密页）。
 *   横幅不打断任何流程，安全提示也不丢（账号的密码是系统随机生成的，
 *   运营和用户都不知道；不设的话这个账号等于没有密码保护）。
 */
const goSetPassword = () => {
  router.push({ path: '/profile', query: { tab: 'profile', force: 'password' } })
}

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
  window.addEventListener('app:password-change-required', onPasswordChangeRequired)
  // 顶栏滚动监听
  window.addEventListener('scroll', onScroll, { passive: true })

  // 从localStorage恢复语言设置，默认中文
  const savedLanguage = localStorage.getItem('language') || 'zh-CN'
  localStorage.setItem('language', savedLanguage)

  // 语言包按需加载：恢复的语言若还没下过，先加载再切（避免闪一下 fallback）
  await ensureLocale(savedLanguage)
  locale.value = savedLanguage
  // <html lang> 跟着界面语言走（保存的语言可能与默认值相同 → watcher 不触发，这里兜底）
  syncDocumentLang(locale.value)
  
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
 * 移动端高度必须 ≥44px：早期 padding 只有 0.25rem，实测总高 28–30px，
 * 低于触控目标 32px 的下限，手指很难点中（iOS 建议 44px）。
 *
 * 之前这里设的是 36px —— 注释写着 44px、实现却是 36px（第 30 轮实测复核时才发现）。
 * 现统一到 44px；sm+ 仍用紧凑高度（桌面用鼠标，不靠触达面积）。
 */
.portal-lang-select {
  font-size: 0.75rem;
  line-height: 1.25rem;
  padding: 0.4375rem 0.375rem;
  min-height: 44px;
  min-width: 4.875rem;
}
.portal-currency-select {
  font-size: 0.75rem;
  line-height: 1.25rem;
  padding: 0.4375rem 0.25rem;
  min-height: 44px;
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