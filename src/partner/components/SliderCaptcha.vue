<template>
  <div class="select-none">
    <div class="mb-2 flex items-center justify-between">
      <p class="text-sm font-medium text-gray-700">{{ t('captcha.title') }}</p>
      <button
        type="button"
        class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 touch-manipulation disabled:opacity-50"
        :aria-label="t('captcha.title')"
        :disabled="loading"
        @click="refresh"
      >
        <ArrowPathIcon class="h-4 w-4" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <div
      class="relative w-full overflow-hidden rounded-xl bg-gray-100 ring-1 ring-gray-200"
      :style="{ aspectRatio: `${width} / ${height}` }"
    >
      <img
        v-if="bg"
        :src="bg"
        alt=""
        draggable="false"
        class="pointer-events-none absolute inset-0 h-full w-full"
      />
      <img
        v-if="piece && ready"
        :src="piece"
        alt=""
        draggable="false"
        :class="[
          'pointer-events-none absolute h-auto',
          dragging ? '' : 'transition-[left] duration-150 ease-out'
        ]"
        :style="pieceStyle"
      />
      <div
        v-if="loading"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-100/90 text-gray-500"
      >
        <span
          class="h-6 w-6 rounded-full border-2 border-primary-500/40 border-t-primary-600 animate-spin"
          aria-hidden="true"
        />
        <span class="text-xs">{{ t('captcha.loading') }}</span>
      </div>
      <button
        v-else-if="loadError"
        type="button"
        class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-100 text-xs text-gray-500 touch-manipulation"
        @click="refresh"
      >
        <ArrowPathIcon class="h-5 w-5" />
        <span>{{ t('captcha.loadFailed') }}</span>
      </button>
    </div>

    <div
      ref="trackRef"
      class="relative mt-3 h-11 rounded-full ring-1 transition-colors"
      :class="trackClass"
    >
      <div
        class="absolute inset-y-0 left-0 rounded-full transition-colors"
        :class="fillClass"
        :style="{ width: fillWidth }"
      />
      <p
        v-if="!dragging && sliderX === 0 && status === ''"
        class="pointer-events-none absolute inset-0 flex items-center justify-center px-12 text-center text-xs text-gray-400"
      >
        {{ t('captcha.slideTip') }}
      </p>
      <button
        type="button"
        class="absolute top-0 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/10 touch-none disabled:cursor-not-allowed disabled:opacity-60"
        :style="{ left: handleLeft }"
        :disabled="!ready"
        :aria-label="t('captcha.slideTip')"
        @pointerdown="onPointerDown"
      >
        <ChevronDoubleRightIcon class="h-5 w-5 text-primary-600" />
      </button>
    </div>

    <p v-if="status === 'fail'" class="mt-2 text-xs text-red-600">{{ t('captcha.failed') }}</p>
    <p v-else-if="status === 'success'" class="mt-2 text-xs text-emerald-600">{{ t('captcha.success') }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowPathIcon, ChevronDoubleRightIcon } from '@heroicons/vue/24/outline'
import config from '../../config/index.js'

const emit = defineEmits(['verify'])

const { t } = useI18n()

const HANDLE_PX = 44

const width = ref(300)
const height = ref(150)
const pieceWidth = ref(44)
const maxX = ref(256)
const pieceY = ref(0)
const bg = ref('')
const piece = ref('')
const token = ref('')

const loading = ref(false)
const loadError = ref(false)
const status = ref('')
const dragging = ref(false)
const sliderX = ref(0)
const trackRef = ref(null)

let dragStartClientX = 0
let dragStartX = 0
let dragTrackWidth = 1
let failTimer = null

const ready = computed(() => !loading.value && !loadError.value && !!token.value && status.value !== 'success')

const progress = computed(() => (maxX.value > 0 ? sliderX.value / maxX.value : 0))

const pieceStyle = computed(() => ({
  left: `${(sliderX.value / width.value) * 100}%`,
  top: `${(pieceY.value / height.value) * 100}%`,
  width: `${(pieceWidth.value / width.value) * 100}%`
}))

const handleLeft = computed(() => `calc(${progress.value * 100}% - ${progress.value * HANDLE_PX}px)`)
const fillWidth = computed(() => `calc(${progress.value * 100}% - ${progress.value * HANDLE_PX}px + ${HANDLE_PX / 2}px)`)

const trackClass = computed(() => {
  if (status.value === 'success') return 'bg-emerald-50 ring-emerald-200'
  if (status.value === 'fail') return 'bg-red-50 ring-red-200'
  return 'bg-gray-100 ring-gray-200'
})

const fillClass = computed(() => {
  if (status.value === 'success') return 'bg-emerald-100'
  if (status.value === 'fail') return 'bg-red-100'
  return 'bg-primary-100'
})

async function refresh () {
  if (failTimer) {
    clearTimeout(failTimer)
    failTimer = null
  }
  loading.value = true
  loadError.value = false
  status.value = ''
  sliderX.value = 0
  try {
    const res = await fetch(config.buildApiUrl('/api/security/captcha'))
    const json = await res.json()
    const d = json && json.data
    if (!json || !json.success || !d || !d.token) throw new Error('invalid captcha payload')
    token.value = d.token
    bg.value = d.bg || ''
    piece.value = d.piece || ''
    pieceY.value = Number(d.y) || 0
    width.value = Number(d.width) || 300
    height.value = Number(d.height) || 150
    pieceWidth.value = Number(d.pieceWidth) || 44
    maxX.value = Number(d.maxX) || 256
  } catch (err) {
    console.error('[partner-captcha] load failed:', err)
    token.value = ''
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function reset () {
  sliderX.value = 0
  status.value = ''
}

function fail () {
  status.value = 'fail'
  if (failTimer) clearTimeout(failTimer)
  failTimer = setTimeout(() => {
    failTimer = null
    refresh()
  }, 900)
}

function succeed () {
  if (failTimer) {
    clearTimeout(failTimer)
    failTimer = null
  }
  status.value = 'success'
}

function onPointerDown (e) {
  if (!ready.value || dragging.value) return
  dragging.value = true
  dragStartClientX = e.clientX
  dragStartX = sliderX.value
  dragTrackWidth = trackRef.value?.getBoundingClientRect().width || 1
  e.currentTarget.setPointerCapture?.(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove (e) {
  if (!dragging.value) return
  const logicalDx = ((e.clientX - dragStartClientX) / dragTrackWidth) * maxX.value
  sliderX.value = Math.min(maxX.value, Math.max(0, dragStartX + logicalDx))
}

function onPointerUp () {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  emit('verify', Math.round(sliderX.value))
}

onMounted(refresh)

onBeforeUnmount(() => {
  if (failTimer) clearTimeout(failTimer)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})

defineExpose({ refresh, reset, fail, succeed, token })
</script>
