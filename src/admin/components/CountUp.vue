<template>
  <span class="ui-count-up tabular-nums">{{ display }}</span>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

/**
 * Admin 数字滚动（与 Portal CountUp.vue 同实现）
 */

const props = defineProps({
  value: { type: [Number, String], required: true },
  decimals: { type: Number, default: 0 },
  duration: { type: Number, default: 600 }
})

const display = ref('0')

const easeOut = (t) => 1 - Math.pow(1 - t, 3)

function animate (from, to, duration) {
  if (duration <= 0) {
    display.value = format(to)
    return
  }
  const startTime = performance.now()
  const step = (now) => {
    const t = Math.min((now - startTime) / duration, 1)
    const eased = easeOut(t)
    const current = from + (to - from) * eased
    display.value = format(current)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function format (n) {
  return Number(n).toFixed(props.decimals)
}

let lastValue = 0
watch(
  () => props.value,
  (next) => {
    const target = Number(next) || 0
    animate(lastValue, target, props.duration)
    lastValue = target
  }
)

onMounted(() => {
  const target = Number(props.value) || 0
  animate(0, target, props.duration)
  lastValue = target
})
</script>

<style scoped>
.ui-count-up {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
