<template>
  <div class="min-h-[100dvh] flex flex-col bg-gray-50 text-gray-900">
    <ToastContainer />
    <header
      v-if="showNav"
      class="sticky top-0 z-30 border-b border-gray-200/90 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80"
      :style="{ paddingTop: 'max(0px, env(safe-area-inset-top))' }"
    >
      <!-- 移动端展开的菜单背后点击关闭 -->
      <div
        v-if="navMenuOpen"
        class="fixed inset-0 z-[20] bg-black/25 sm:hidden"
        aria-hidden="true"
        @click="closeNavMenu"
      />
      <div class="relative z-[21] max-w-6xl mx-auto px-3 sm:px-4 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
        <div class="flex items-center gap-2 min-h-[3.25rem] sm:min-h-14 flex-nowrap">
          <div class="flex-1 min-w-0 py-1">
            <p class="text-[15px] sm:text-base font-semibold tracking-tight text-gray-900 truncate">
              {{ t('nav.brand') }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <select
              v-model="locale"
              class="text-xs border-gray-200 rounded-lg px-2 py-1.5 sm:px-2.5 sm:py-1.5 bg-white max-w-[6.75rem] sm:max-w-[8.25rem] min-w-[5.75rem] sm:min-w-[6.75rem] touch-manipulation"
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
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.shop') }}
            </router-link>
            <router-link
              to="/orders"
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.orders') }}
            </router-link>
            <router-link
              to="/addresses"
              class="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px] inline-flex items-center text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              active-class="!bg-primary-100 !text-primary-700 hover:!bg-primary-100"
            >
              {{ t('nav.addresses') }}
            </router-link>
          </nav>
          <button
            type="button"
            class="hidden sm:inline-flex touch-manipulation min-h-[44px] px-2 sm:px-3 text-sm font-medium text-gray-600 hover:text-red-600 rounded-lg hover:bg-red-50 whitespace-nowrap shrink-0 items-center"
            @click="logout"
          >
            {{ t('nav.logout') }}
          </button>
          <!-- 移动端：菜单合集按钮 -->
          <button
            type="button"
            class="sm:hidden touch-manipulation min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-800 shrink-0"
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
          class="-mx-3 sm:-mx-4 px-3 sm:px-4 pt-1 pb-2 border-t border-gray-100 bg-white/70"
        >
          <p class="text-sm text-gray-600 truncate">
            {{ t('nav.welcome', { name: welcomeDisplayName }) }}
          </p>
        </div>
      </div>
    </header>
    <main class="flex-1 w-full pb-[max(1rem,env(safe-area-inset-bottom))]">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bars3Icon, XMarkIcon } from '@heroicons/vue/24/outline'
import ToastContainer from './components/ToastContainer.vue'
import { usePartnerStore } from './stores/partner.js'

const route = useRoute()
const router = useRouter()
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
  localStorage.setItem('partner-locale', locale.value)
}

function logout () {
  partnerStore.logout()
  router.push('/login')
}

watch(
  () => route.fullPath,
  () => closeNavMenu()
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
</script>
