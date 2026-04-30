<template>
  <div class="relative min-h-[100dvh] overflow-hidden flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-primary-900 text-white">
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary-500/25 blur-3xl" />
      <div class="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
    </div>

    <div class="relative flex-1 flex flex-col min-h-0 py-10 sm:py-12 px-4 sm:px-6">
      <div class="w-full max-w-md mx-auto text-center animate-fade-in">
        <div class="flex justify-center">
          <div
            class="h-16 w-16 rounded-2xl bg-white/15 ring-2 ring-white/25 shadow-strong backdrop-blur flex items-center justify-center"
          >
            <BuildingStorefrontIcon class="h-9 w-9 text-white" />
          </div>
        </div>
        <h1 class="mt-6 text-2xl sm:text-3xl font-extrabold tracking-tight">
          {{ t('login.title') }}
        </h1>
      </div>

      <div class="mt-8 w-full max-w-md mx-auto flex-1 flex flex-col justify-center">
        <div class="rounded-2xl bg-white shadow-strong ring-1 ring-black/5 p-6 sm:p-8 text-gray-900 animate-slide-up">
          <form class="space-y-5" @submit.prevent="onSubmit">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('login.loginName') }}</label>
              <input
                v-model.trim="login"
                type="text"
                autocomplete="username"
                required
                :placeholder="t('login.placeholderLogin')"
                class="block w-full rounded-xl border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-base py-3 px-3.5 placeholder:text-gray-400"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('login.password') }}</label>
              <div class="relative">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  required
                  :placeholder="t('login.placeholderPwd')"
                  class="block w-full rounded-xl border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-base py-3 pr-11 pl-3.5 placeholder:text-gray-400"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 flex items-center p-2 touch-manipulation text-gray-400 hover:text-gray-600 rounded-lg"
                  :aria-label="t('login.hintPwd')"
                  @click="showPassword = !showPassword"
                >
                  <EyeIcon v-if="!showPassword" class="w-5 h-5" />
                  <EyeSlashIcon v-else class="w-5 h-5" />
                </button>
              </div>
            </div>
            <button
              type="submit"
              :disabled="loading"
              class="w-full inline-flex justify-center items-center rounded-xl bg-primary-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation min-h-[48px]"
            >
              <span v-if="loading" class="inline-flex items-center gap-2">
                <span
                  class="h-5 w-5 border-2 border-white/35 border-t-white rounded-full animate-spin"
                  aria-hidden="true"
                />
                {{ t('login.logging') }}
              </span>
              <span v-else>{{ t('login.loginBtn') }}</span>
            </button>
          </form>
        </div>
      </div>

      <div
        class="mt-auto pt-6 w-full max-w-md mx-auto flex flex-row justify-between items-center gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <p class="text-left text-xs text-slate-400 flex-1 min-w-0 leading-snug">
          {{ t('login.forgotHint') }}
        </p>
        <select
          v-model="localeModel"
          class="shrink-0 text-xs rounded-lg px-2.5 py-1.5 bg-white/10 border border-white/20 text-white min-w-[7.75rem] max-w-[10rem] touch-manipulation"
          @change="persistLocale"
        >
          <option class="text-gray-900" value="zh-CN">{{ t('locale.zh') }}</option>
          <option class="text-gray-900" value="en-US">{{ t('locale.en') }}</option>
          <option class="text-gray-900" value="th-TH">{{ t('locale.th') }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { BuildingStorefrontIcon, EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { usePartnerStore } from '../stores/partner.js'
import { useToast } from '../composables/useToast.js'

const route = useRoute()
const router = useRouter()
const partnerStore = usePartnerStore()
const toast = useToast()
const { t, locale } = useI18n()

const localeModel = computed({
  get: () => locale.value,
  set: (v) => {
    locale.value = v
  }
})

function persistLocale () {
  localStorage.setItem('partner-locale', locale.value)
}

const login = ref('')
const password = ref('')
const loading = ref(false)
const showPassword = ref(false)

async function onSubmit () {
  loading.value = true
  try {
    const r = await partnerStore.login(login.value, password.value)
    if (r.success) {
      toast.success(t('login.loginSuccess'))
      const red = route.query.redirect || '/shop'
      router.push(red)
    } else {
      toast.error(r.message || t('login.loginFail'))
    }
  } finally {
    loading.value = false
  }
}
</script>
