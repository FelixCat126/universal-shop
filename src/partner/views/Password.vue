<template>
  <div class="max-w-md mx-auto px-3 sm:px-4 py-4 sm:py-6">
    <header class="mb-4">
      <h1 class="text-lg font-semibold text-gray-900">{{ t('password.title') }}</h1>
      <p class="text-xs text-gray-500 mt-1">{{ t('password.subtitle') }}</p>
    </header>

    <!-- 强制改密提示：初始密码是运营线下告知的临时口令，必须换成自己的 -->
    <div
      v-if="forced"
      class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      role="alert"
    >
      {{ t('password.forcedHint') }}
    </div>

    <form class="rounded-xl border border-gray-100 bg-white shadow-soft p-4 space-y-4" @submit.prevent="submit">
      <div>
        <label for="pw-current" class="block text-sm font-medium text-gray-700 mb-1">
          {{ t('password.current') }}
        </label>
        <input
          id="pw-current"
          v-model="form.current"
          type="password"
          autocomplete="current-password"
          class="w-full min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          :placeholder="t('password.currentPlaceholder')"
        >
      </div>

      <div>
        <label for="pw-new" class="block text-sm font-medium text-gray-700 mb-1">
          {{ t('password.new') }}
        </label>
        <input
          id="pw-new"
          v-model="form.next"
          type="password"
          autocomplete="new-password"
          class="w-full min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          :placeholder="t('password.newPlaceholder')"
        >
        <p class="mt-1 text-xs text-gray-500">{{ t('password.policy') }}</p>
      </div>

      <div>
        <label for="pw-confirm" class="block text-sm font-medium text-gray-700 mb-1">
          {{ t('password.confirm') }}
        </label>
        <input
          id="pw-confirm"
          v-model="form.confirm"
          type="password"
          autocomplete="new-password"
          class="w-full min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          :placeholder="t('password.confirmPlaceholder')"
        >
      </div>

      <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>

      <button
        type="submit"
        class="w-full min-h-[48px] rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700 active:opacity-95 disabled:opacity-50"
        :disabled="submitting"
      >
        {{ submitting ? t('password.submitting') : t('password.submit') }}
      </button>

      <button
        v-if="!forced"
        type="button"
        class="w-full min-h-[44px] rounded-xl border border-gray-200 text-sm font-medium text-gray-600"
        @click="goBack"
      >
        {{ t('password.back') }}
      </button>
    </form>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { usePartnerStore } from '../stores/partner.js'
import { useToast } from '../composables/useToast.js'

const { t } = useI18n()
const router = useRouter()
const store = usePartnerStore()
const toast = useToast()

const form = reactive({ current: '', next: '', confirm: '' })
const submitting = ref(false)
const error = ref('')

/**
 * 强制改密模式：账号是运营用初始口令建的，
 * 在改完之前只能停在这一页（服务端也会拦）。
 */
const forced = computed(() => !!store.profile?.must_reset_password)

/** 与服务端 assertPasswordPolicy 同一把尺子（≥8 位 + 字母 + 数字） */
function checkPolicy (pwd) {
  if (!pwd) return t('password.errRequired')
  if (pwd.length < 8) return t('password.errLength')
  if (!/[0-9]/.test(pwd)) return t('password.errDigit')
  if (!/[A-Za-z]/.test(pwd)) return t('password.errLetter')
  return ''
}

async function submit () {
  error.value = ''
  // 先记住"是不是强制改密"：改成功后标记会被清掉，那时再问就问不出来了
  const wasForced = forced.value
  if (!form.current || !form.next) {
    error.value = t('password.errRequired')
    return
  }
  const policyError = checkPolicy(form.next)
  if (policyError) {
    error.value = policyError
    return
  }
  if (form.next !== form.confirm) {
    error.value = t('password.errMismatch')
    return
  }
  if (form.next === form.current) {
    error.value = t('password.errSame')
    return
  }

  submitting.value = true
  try {
    const res = await store.api('/me/password', {
      method: 'PUT',
      body: JSON.stringify({
        current_password: form.current,
        new_password: form.next
      })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) {
      error.value = json?.message || t('password.errFailed')
      return
    }
    // 服务端换了 token_version 并发了新 token —— 必须换上，否则下一次请求就被判失效
    if (json.data?.token) store.setToken(json.data.token)
    if (store.profile) store.persistProfile({ ...store.profile, must_reset_password: false })

    form.current = ''
    form.next = ''
    form.confirm = ''
    toast.showToast(t('password.success'), 'success')
    if (wasForced) {
      router.replace('/shop')
    }
  } catch (e) {
    console.error('[partner] change password failed:', e)
    error.value = t('password.errFailed')
  } finally {
    submitting.value = false
  }
}

function goBack () {
  router.back()
}
</script>
