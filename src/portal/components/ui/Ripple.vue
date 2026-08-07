<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="['ui-btn-ripple', customClass]"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup>
/**
 * Ripple 按钮（CSS only，无需 JS 动画库）
 *
 * 用法：
 *   <Ripple>Click me</Ripple>
 *   <Ripple custom-class="bg-blue-600 text-white">提交</Ripple>
 */

defineProps({
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
  customClass: { type: String, default: '' }
})

defineEmits(['click'])
</script>
