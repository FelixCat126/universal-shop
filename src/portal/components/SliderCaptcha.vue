<template>
  <div class="w-[300px] select-none">
    <p class="mb-2 text-sm font-medium text-gray-700">{{ t('captcha.title') }}</p>

    <!-- 拼图区：底图 + 缺口拼图块 -->
    <div class="relative w-[300px] h-[150px] rounded-md overflow-hidden bg-gray-100 border border-gray-200">
      <img
        v-if="captcha"
        :src="captcha.bg"
        class="block w-full h-full"
        draggable="false"
        alt=""
      />
      <img
        v-if="captcha"
        :src="captcha.piece"
        class="absolute pointer-events-none"
        :style="{ top: captcha.y + 'px', left: sliderX + 'px', width: captcha.pieceWidth + 'px' }"
        draggable="false"
        alt=""
      />
      <div
        v-if="loading"
        class="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-gray-500"
      >
        {{ t('captcha.loading') }}...
      </div>
      <div
        v-else-if="loadError"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 text-sm text-red-600"
      >
        <span>{{ t('error.loadFailed') }}</span>
        <button type="button" class="text-blue-600 hover:underline" @click="refresh">
          {{ t('common.retry') }}
        </button>
      </div>
    </div>

    <!-- 滑轨 + 手柄（宽 44，行程 0..maxX 与拼图块 x 一一对应） -->
    <div
      class="relative mt-3 h-10 w-[300px] rounded-full border border-gray-300 bg-gray-100 flex items-center justify-center"
    >
      <span class="pointer-events-none text-xs text-gray-400">{{ t('captcha.slideTip') }}</span>
      <div
        class="absolute left-0 top-0 flex h-full w-11 cursor-grab items-center justify-center rounded-full bg-blue-600 text-white shadow active:cursor-grabbing touch-none"
        :style="{ transform: `translateX(${sliderX}px)` }"
        @pointerdown="onPointerDown"
      >
        <ArrowRightIcon class="h-5 w-5" />
      </div>
    </div>

    <!-- 状态提示 -->
    <p v-if="status === 'failed'" class="mt-2 text-xs text-red-600">{{ t('captcha.failed') }}</p>
    <p v-else-if="status === 'success'" class="mt-2 text-xs text-green-600">{{ t('captcha.success') }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightIcon } from '@heroicons/vue/24/outline'
import api from '../api/index.js'

const emit = defineEmits(['verify'])
const { t } = useI18n()

const captcha = ref(null)
const loading = ref(false)
const loadError = ref(false)
const status = ref('')
const sliderX = ref(0)
const dragging = ref(false)

const maxX = computed(() => captcha.value?.maxX ?? 256)
const token = computed(() => captcha.value?.token || '')

let dragStartX = 0
let dragStartSliderX = 0

const fetchCaptcha = async () => {
  loading.value = true
  loadError.value = false
  try {
    const { data } = await api.get('/security/captcha')
    if (data?.success && data.data) {
      captcha.value = data.data
      sliderX.value = 0
    } else {
      loadError.value = true
    }
  } catch (error) {
    console.error('Fetch captcha error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const clampX = (x) => Math.min(Math.max(x, 0), maxX.value)

const onPointerMove = (event) => {
  if (!dragging.value) return
  sliderX.value = clampX(dragStartSliderX + event.clientX - dragStartX)
}

const onPointerUp = () => {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  emit('verify', Math.round(sliderX.value))
}

const onPointerDown = (event) => {
  if (loading.value || loadError.value || !captcha.value) return
  dragging.value = true
  dragStartX = event.clientX
  dragStartSliderX = sliderX.value
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  event.preventDefault()
}

// 重新拉取验证码并归零（token 一次性，任何重试前都必须换新题）
const refresh = () => {
  status.value = ''
  fetchCaptcha()
}

// 验证失败：提示并自动刷新换题
const showFailed = () => {
  status.value = 'failed'
  fetchCaptcha()
}

const showSuccess = () => {
  status.value = 'success'
}

onMounted(fetchCaptcha)

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})

defineExpose({ refresh, showFailed, showSuccess, token })
</script>
