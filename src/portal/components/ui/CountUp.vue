<template>
  <span class="ui-count-up" :class="{ 'tabular-nums': tabular }">{{ display }}</span>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

/**
 * 数字滚动动画
 *
 * 用法：
 *   <CountUp :value="1234" />                    // 从 0 滚到 1234
 *   <CountUp :value="12.34" :decimals="2" />     // 保留 2 位小数
 *   <CountUp :value="100" :duration="800" />     // 800ms 完成
 */

const props = defineProps({
  value: { type: [Number, String], required: true },
  decimals: { type: Number, default: 0 },
  duration: { type: Number, default: 600 },
  tabular: { type: Boolean, default: true }
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
