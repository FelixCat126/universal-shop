<template>
  <div class="slider-captcha" :class="{ 'is-dragging': dragging }">
    <!-- 拼图区：背景带缺口，拼图块跟随滑块移动 -->
    <div class="captcha-stage">
      <template v-if="captcha">
        <img
          class="captcha-bg"
          :src="captcha.bg"
          :width="captcha.width"
          :height="captcha.height"
          draggable="false"
          alt=""
        />
        <img
          class="captcha-piece"
          :src="captcha.piece"
          :style="pieceStyle"
          draggable="false"
          alt=""
        />
      </template>
      <!-- 加载中 / 加载失败（点击重试）遮罩 -->
      <div
        v-if="loading || loadError"
        class="captcha-mask"
        :class="{ 'is-clickable': loadError }"
        @click="loadError && refresh()"
      >
        <el-icon v-if="loading" class="is-loading" :size="22"><Loading /></el-icon>
        <span>{{ loading ? t('captcha.loading') : t('captcha.failed') }}</span>
      </div>
    </div>

    <!-- 滑轨 + 手柄 -->
    <div class="captcha-track" :class="`is-${status}`">
      <div class="captcha-track-fill" :style="{ width: `${fillWidth}px` }"></div>
      <span class="captcha-track-text">{{ trackText }}</span>
      <div
        class="captcha-handle"
        :class="{ 'is-disabled': !canDrag }"
        :style="{ left: `${sliderX}px` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <el-icon :size="18"><DArrowRight /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loading, DArrowRight } from '@element-plus/icons-vue'
import config from '../../config/index.js'

const emit = defineEmits(['verify'])
const { t } = useI18n()

// 画布尺寸与后端契约固定（300x150，拼图块 44x44，滑程 0..maxX=256）
const STAGE_WIDTH = 300
const HANDLE_WIDTH = 44

const captcha = ref(null)
const loading = ref(false)
const loadError = ref(false)
const status = ref('idle') // idle | success | failed
const waiting = ref(false) // 已提交答案，等待父级登录结果
const dragging = ref(false)
const sliderX = ref(0)

let dragStartClientX = 0
let dragStartSliderX = 0

const maxX = computed(() => captcha.value?.maxX ?? (STAGE_WIDTH - HANDLE_WIDTH))
const fillWidth = computed(() => Math.min(sliderX.value + HANDLE_WIDTH, STAGE_WIDTH))

const pieceStyle = computed(() => ({
  left: `${sliderX.value}px`,
  top: `${captcha.value?.y ?? 0}px`,
  width: `${captcha.value?.pieceWidth ?? HANDLE_WIDTH}px`,
  height: `${captcha.value?.pieceWidth ?? HANDLE_WIDTH}px`
}))

const canDrag = computed(() =>
  !!captcha.value && !loading.value && !loadError.value && !waiting.value && status.value === 'idle'
)

const trackText = computed(() => {
  if (status.value === 'success') return t('captcha.success')
  if (status.value === 'failed') return t('captcha.failed')
  return t('captcha.slideTip')
})

const fetchCaptcha = async () => {
  loading.value = true
  loadError.value = false
  try {
    const response = await fetch(config.buildApiUrl('/api/security/captcha'), { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok || !body?.success || !body.data) throw new Error('bad captcha response')
    captcha.value = body.data
  } catch (error) {
    console.error('加载验证码失败:', error)
    captcha.value = null
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// 重新获取题目（token 一次性，任何重试前都必须换新题）
const refresh = () => {
  sliderX.value = 0
  status.value = 'idle'
  waiting.value = false
  fetchCaptcha()
}

// 父级通知：验证通过（登录成功）
const notifySuccess = () => {
  waiting.value = false
  status.value = 'success'
}

// 父级通知：答案错误/已过期，提示失败后自动换新题
const notifyFailed = () => {
  waiting.value = false
  status.value = 'failed'
  sliderX.value = 0
  setTimeout(() => {
    if (status.value === 'failed') refresh()
  }, 600)
}

const getToken = () => captcha.value?.token || ''

const onPointerDown = (event) => {
  if (!canDrag.value) return
  dragging.value = true
  dragStartClientX = event.clientX
  dragStartSliderX = sliderX.value
  // pointer capture 保证指针移出手柄后 move/up 事件仍派发到手柄（兼容 touch）
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

const onPointerMove = (event) => {
  if (!dragging.value) return
  const next = dragStartSliderX + (event.clientX - dragStartClientX)
  sliderX.value = Math.min(Math.max(0, next), maxX.value)
}

const onPointerUp = () => {
  if (!dragging.value) return
  dragging.value = false
  if (!canDrag.value) return
  waiting.value = true
  emit('verify', Math.round(sliderX.value))
}

// 系统中断（如触摸被浏览器接管手势）只取消本次拖动，不提交答案
const onPointerCancel = () => {
  dragging.value = false
}

onMounted(fetchCaptcha)

defineExpose({ refresh, notifySuccess, notifyFailed, getToken })
</script>

<style scoped>
.slider-captcha {
  width: 300px;
  user-select: none;
}

/* 拼图区 */
.captcha-stage {
  position: relative;
  width: 300px;
  height: 150px;
  border-radius: 8px;
  overflow: hidden;
  background: #f0f2f5;
}

.captcha-bg {
  display: block;
  width: 300px;
  height: 150px;
  -webkit-user-drag: none;
}

.captcha-piece {
  position: absolute;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
  transition: left 0.25s ease;
  -webkit-user-drag: none;
}

.slider-captcha.is-dragging .captcha-piece {
  transition: none;
}

.captcha-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
  background: #f0f2f5;
}

.captcha-mask.is-clickable {
  cursor: pointer;
}

/* 滑轨 */
.captcha-track {
  position: relative;
  width: 300px;
  height: 40px;
  margin-top: 12px;
  border-radius: 20px;
  background: #f5f7fa;
  border: 1px solid #dcdfe6;
  overflow: hidden;
}

.captcha-track-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(64, 158, 255, 0.18);
  transition: width 0.25s ease;
}

.slider-captcha.is-dragging .captcha-track-fill {
  transition: none;
}

.captcha-track.is-success .captcha-track-fill {
  background: rgba(103, 194, 58, 0.25);
}

.captcha-track.is-failed .captcha-track-fill {
  background: rgba(245, 108, 108, 0.2);
}

.captcha-track-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #909399;
  pointer-events: none;
}

.captcha-track.is-success .captcha-track-text {
  color: #67c23a;
}

.captcha-track.is-failed .captcha-track-text {
  color: #f56c6c;
}

/* 手柄 */
.captcha-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 44px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 19px;
  background: #fff;
  color: #409eff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  cursor: grab;
  touch-action: none;
  transition: left 0.25s ease;
  z-index: 2;
}

.slider-captcha.is-dragging .captcha-handle {
  transition: none;
  cursor: grabbing;
}

.captcha-handle.is-disabled {
  cursor: not-allowed;
  color: #c0c4cc;
}

.captcha-track.is-success .captcha-handle {
  color: #67c23a;
}

.captcha-track.is-failed .captcha-handle {
  color: #f56c6c;
}
</style>
