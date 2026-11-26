<template>
  <!--
    Cookie / 本地存储告知横幅（第 54 轮）

    为什么需要：可商用商城在欧盟 GDPR / 泰国 PDPA 语境下，
    必须在**使用非必要存储前**告知用户。本站只用 localStorage 存
    登录态、语言与币种偏好（不用于广告追踪），所以这是一条**告知**而非拦截。

    为什么用 localStorage 而不是 Cookie：
    本站**根本没有用 Cookie**（认证走 Authorization 头 + localStorage），
    这条横幅告知的是"我们用了浏览器本地存储"这件事本身，
    状态存在哪儿无所谓 —— 与全站其它持久化保持一致即可（不引入 cookie 机制）。

    同意状态落盘（连"拒绝"也落）→ 不会每次打开都弹。
  -->
  <div
    v-if="visible"
    class="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
    role="region"
    :aria-label="t('cookie.title')"
  >
    <div class="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 text-sm text-gray-700">
        <p class="font-medium text-gray-900">{{ t('cookie.title') }}</p>
        <p class="mt-1 leading-relaxed">{{ t('cookie.body') }}</p>
        <router-link
          to="/privacy"
          class="mt-1 inline-flex items-center min-h-[32px] text-blue-600 underline hover:text-blue-700"
        >{{ t('legal.privacyLink') }}</router-link>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          @click="accept"
        >
          {{ t('cookie.accept') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/** 同意状态落盘的键（与全站其它 localStorage 用法一致） */
const CONSENT_KEY = 'cookie_consent_at'

const visible = ref(false)

/**
 * 读取已保存的同意状态。
 *
 * 存的是**时间戳**而不是布尔 —— 万一以后要改横幅文案或新增用途，
 * "什么时候同意的"比"同不同意过"更有用（GDPR 要求可证明同意时点）。
 */
function readConsent () {
  try {
    return localStorage.getItem(CONSENT_KEY)
  } catch {
    // 隐私模式 / 禁用存储 → 当作未同意，横幅会一直显示（这是安全侧的行为）
    return null
  }
}

function accept () {
  try {
    localStorage.setItem(CONSENT_KEY, new Date().toISOString())
  } catch {
    // 存不了也不该阻断用户（横幅只是告知）
  }
  visible.value = false
}

onMounted(() => {
  visible.value = !readConsent()
})
</script>
