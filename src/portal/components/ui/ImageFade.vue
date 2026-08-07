<template>
  <img
    :src="src"
    :alt="alt"
    :class="['ui-img-fade', { 'is-loaded': loaded }, customClass]"
    :loading="loading"
    @load="onLoad"
    @error="onError"
  >
</template>

<script setup>
import { ref } from 'vue'

/**
 * 图片 fade-in 组件
 *
 * 用法：
 *   <ImageFade :src="url" alt="..." />
 *   <ImageFade :src="url" custom-class="rounded-lg" />
 */

const props = defineProps({
  src: { type: String, required: true },
  alt: { type: String, default: '' },
  customClass: { type: String, default: '' },
  loading: { type: String, default: 'lazy' },
  eager: { type: Boolean, default: false }
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
