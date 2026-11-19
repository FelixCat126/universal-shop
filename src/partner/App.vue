<template>
  <div class="min-h-[100dvh] flex flex-col bg-[#f1f5f4] text-gray-900">
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
        class="mt-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:opacity-90"
        @click="reloadPage"
      >
        {{ t('common.reload') }}
      </button>
    </div>
    <ToastContainer />
    <header
      v-if="showNav"
      class="sticky top-0 z-30 border-b border-primary-900/40 bg-primary-900/95 backdrop-blur-md supports-[backdrop-filter]:bg-primary-900/85"
      :style="{ paddingTop: 'max(0px, env(safe-area-inset-top))' }"
    >
      <!-- 移动端展开的菜单背后点击关闭 -->
      <div
        v-if="navMenuOpen"
        class="fixed inset-0 z-[20] bg-black/25 sm:hidden"
        aria-hidden="true"
        @click="closeNavMenu"
      />
      <div class="relative z-[21] max-w-6xl mx-auto px-3 sm:px-4 bg-primary-900/95 backdrop-blur-md supports-[backdrop-filter]:bg-primary-900/85">
        <div class="flex items-center gap-2 min-h-[3.25rem] sm:min-h-14 flex-nowrap">
          <!-- 品牌区：与登录页同一个标识（白底墨绿图形），两处保持一致 -->
          <div class="flex items-center gap-2 flex-1 min-w-0 py-1">
            <PartnerLogo
              box-class="h-8 w-8 rounded-lg bg-white text-primary-700"
              icon-class="h-5 w-5"
            />
            <p class="text-[15px] sm:text-base font-semibold tracking-tight text-white truncate">
              {{ t('nav.brand') }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <select
              v-model="locale"
              class="text-xs border-gray-200 rounded-lg px-2 py-1.5 sm:px-2.5 sm:py-1.5 bg-white max-w-[6.75rem] sm:max-w-[8.25rem] min-w-[5.75rem] sm:min-w-[6.75rem] touch-manipulation min-h-[44px] sm:min-h-0"
              @change="onLocaleChange"
            >
              <option value="zh-CN">{{ t('locale.zh') }}</option>
              <option value="en-US">{{ t('locale.en') }}</option>
              <option value="th-TH">{{ t('locale.th') }}</option>
            </select>
          </div>
          <!-- sm+ ：横向菜单 -->
          <nav class="hidden sm:flex items-center shrink-0 gap-0.5 sm:gap-1 overflow-x-auto no-scrollbar" aria-label="nav">
            <router-link
              to="/shop"
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-primary-100 hover:bg-white/15 hover:text-white"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.shop') }}
            </router-link>
            <router-link
              to="/orders"
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-primary-100 hover:bg-white/15 hover:text-white"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.orders') }}
            </router-link>
            <router-link
              to="/addresses"
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-primary-100 hover:bg-white/15 hover:text-white"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.addresses') }}
            </router-link>
            <router-link
              to="/password"
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-primary-100 hover:bg-white/15 hover:text-white"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.password') }}
            </router-link>
          </nav>
          <button
            type="button"
            class="hidden sm:inline-flex touch-manipulation min-h-[44px] px-2 sm:px-3 text-sm font-medium text-primary-100 hover:text-white rounded-lg hover:bg-white/15 whitespace-nowrap shrink-0 items-center"
            @click="logout"
          >
            {{ t('nav.logout') }}
          </button>
          <!-- 移动端：菜单合集按钮 -->
          <button
            type="button"
            class="sm:hidden touch-manipulation min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 text-white shrink-0"
            :aria-expanded="navMenuOpen"
            :aria-label="navMenuOpen ? t('nav.menuCloseAria') : t('nav.menuAria')"
            @click="toggleNavMenu"
          >
            <XMarkIcon v-if="navMenuOpen" class="h-6 w-6" aria-hidden="true" />
            <Bars3Icon v-else class="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        <!-- 移动端：纵向展开的导航 -->
        <div
          v-show="navMenuOpen"
          class="sm:hidden border-t border-gray-100 py-2 space-y-0.5"
        >
          <router-link
            to="/shop"
            class="flex w-full items-center rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-gray-50 touch-manipulation"
            active-class="!bg-primary-50 !text-primary-800 font-semibold"
            @click="closeNavMenu"
          >
            {{ t('nav.shop') }}
          </router-link>
          <router-link
            to="/orders"
            class="flex w-full items-center rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-gray-50 touch-manipulation"
            active-class="!bg-primary-50 !text-primary-800 font-semibold"
            @click="closeNavMenu"
          >
            {{ t('nav.orders') }}
          </router-link>
          <router-link
            to="/addresses"
            class="flex w-full items-center rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-gray-50 touch-manipulation"
            active-class="!bg-primary-50 !text-primary-800 font-semibold"
            @click="closeNavMenu"
          >
            {{ t('nav.addresses') }}
          </router-link>
          <router-link
            to="/password"
            class="flex w-full items-center rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-gray-50 touch-manipulation"
            active-class="!bg-primary-50 !text-primary-800 font-semibold"
            @click="closeNavMenu"
          >
            {{ t('nav.password') }}
          </router-link>
          <div class="my-2 border-t border-gray-100" />
          <button
            type="button"
            class="flex w-full items-center rounded-lg px-3 py-3 text-base font-medium text-red-700 hover:bg-red-50 touch-manipulation text-left"
            @click="onMobileLogout"
          >
            {{ t('nav.logout') }}
          </button>
        </div>
        <div
          v-if="showNav && welcomeDisplayName"
          class="-mx-3 sm:-mx-4 px-3 sm:px-4 pt-1 pb-2 border-t border-primary-700/30 bg-[#e6efed]"
        >
          <p class="text-sm text-gray-600 truncate">
            {{ t('nav.welcome', { name: welcomeDisplayName }) }}
          </p>
        </div>
      </div>
    </header>
    <!--
      路由视图：第 37 轮补上过渡 —— 原来**完全没有过渡**（硬切），
      切页时是"啪"一下换掉，比带动画的更像刷新。
      现在与另外两端同一套做法：重叠在场 + 只做 opacity → 无空白帧、无位移。
    -->
    <main class="flex-1 w-full pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div class="route-stage">
        <router-view v-slot="{ Component, route }">
          <Transition name="page-fade">
            <component :is="Component" :key="route.path" class="page-shell" />
          </Transition>
        </router-view>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { syncDocumentLang } from '../utils/htmlLang.js'
import { ensureLocale } from './i18n/index.js'
import { Bars3Icon, XMarkIcon } from '@heroicons/vue/24/outline'
import ToastContainer from './components/ToastContainer.vue'
import { usePartnerStore } from './stores/partner.js'
import { fatalError, reportFatalError } from '../utils/fatalError.js'
import { useRoutePrefetch } from '../utils/routePrefetch.js'
import PartnerLogo from './components/PartnerLogo.vue'

const route = useRoute()
const router = useRouter()
// 路由 chunk 预取：切换批发页面时不再白屏
useRoutePrefetch(router)
const partnerStore = usePartnerStore()
const { t, locale } = useI18n()

const showNav = computed(() => route.name !== 'PartnerLogin')

const navMenuOpen = ref(false)

const welcomeDisplayName = computed(() => {
  const p = partnerStore.profile
  if (!p) return ''
  const dn = typeof p.display_name === 'string' ? p.display_name.trim() : ''
  if (dn) return dn
  const login = typeof p.login === 'string' ? p.login.trim() : ''
  return login || ''
})

function toggleNavMenu () {
  navMenuOpen.value = !navMenuOpen.value
}

function closeNavMenu () {
  navMenuOpen.value = false
}

function onMobileLogout () {
  closeNavMenu()
  logout()
}

function onLocaleChange () {
  // 语言包按需加载：切之前先把它拉下来，避免闪一下 fallback
  ensureLocale(locale.value).finally(() => {
    localStorage.setItem('partner-locale', locale.value)
  })
}

function logout () {
  partnerStore.logout()
  router.push('/login')
}

watch(
  () => route.fullPath,
  () => closeNavMenu()
)

/**
 * 切语言时：
 *  1) 更新浏览器标签页标题 —— 之前**从不更新**，切到泰文/英文后标签页
 *     还写着中文"合作方门户 · 订货"（多标签时尤其明显）；
 *  2) 同步 <html lang> —— 否则浏览器以为内容是中文，
 *     屏幕阅读器用中文音读规则念泰文、泰文字体回退也可能出错。
 */
watch(
  () => locale.value,
  (val) => {
    syncDocumentLang(val)
    document.title = t('appTitle')
  },
  { immediate: true }
)

function onKeydown (e) {
  if (e.key === 'Escape') closeNavMenu()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

onErrorCaptured((err, instance, info) => {
  reportFatalError(err, info)
  return false
})

function reloadPage () {
  window.location.reload()
}
</script>
