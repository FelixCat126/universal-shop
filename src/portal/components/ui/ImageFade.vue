<template>
  <img
    :src="src"
    :srcset="srcset"
    :sizes="sizes"
    :alt="alt"
    :class="['ui-img-fade', { 'is-loaded': loaded }, customClass]"
    :loading="loading"
    :fetchpriority="fetchpriority"
    decoding="async"
    @load="onLoad"
    @error="onError"
  >
</template>

<script setup>
import { ref } from 'vue'

/**
 * 图片 fade-in 组件：支持 srcset/sizes/decoding/fetchpriority，降低移动端流量与解码抖动
 */

const props = defineProps({
  src: { type: String, required: true },
  srcset: { type: String, default: undefined },
  sizes: { type: String, default: undefined },
  alt: { type: String, default: '' },
  customClass: { type: String, default: '' },
  loading: { type: String, default: 'lazy' },
  fetchpriority: { type: String, default: 'auto' }
})

const emit = defineEmits(['load', 'error'])

const loaded = ref(false)
/** 是否已经退回过主图（防止无限重试） */
let fellBack = false

function onLoad (e) {
  loaded.value = true
  emit('load', e)
}

function onError (e) {
  /**
   * srcset 里的变体可能不存在（老图没跑过 scripts/reprocess-images.mjs）——
   * 浏览器**不会**在 srcset 候选失败时自动回退到 src，图会直接裂掉。
   * 所以这里主动退回主图再试一次。
   */
  const el = e?.target
  if (!fellBack && el && props.src) {
    fellBack = true
    el.srcset = ''
    el.src = props.src
    return
  }
  // 退回主图仍失败 → 确实没有图了，fade-in 避免一直空白
  loaded.value = true
  emit('error', e)
}
</script>
