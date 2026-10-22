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

function onLoad (e) {
  loaded.value = true
  emit('load', e)
}

function onError (e) {
  // 即使失败也 fade-in，避免一直空白
  loaded.value = true
  emit('error', e)
}
</script>
