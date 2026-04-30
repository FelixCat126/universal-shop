<template>
  <div
    :class="[
      'w-full sm:min-w-[20rem] max-w-md p-3 sm:p-4 rounded-lg shadow-strong border-l-4 backdrop-blur-sm',
      'transform transition-all duration-300 ease-in-out',
      toastClasses,
      { 'opacity-0 scale-95': !toast.visible }
    ]"
  >
    <div class="flex items-start gap-3">
      <div class="shrink-0">
        <component :is="iconComponent" :class="['w-5 h-5', iconClasses]" />
      </div>
      <div class="flex-1 min-w-0">
        <p :class="['text-sm font-medium', textClasses]">{{ toast.message }}</p>
      </div>
      <button
        type="button"
        class="shrink-0 p-1 rounded-full touch-manipulation"
        :class="closeButtonClasses"
        @click="$emit('close', toast.id)"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>
    <div v-if="toast.duration > 0" class="mt-2 h-1 bg-black/10 rounded-full overflow-hidden">
      <div
        :class="['h-full rounded-full', progressClasses]"
        :style="{ animation: `toast-progress ${toast.duration}ms linear forwards` }"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon
} from '@heroicons/vue/24/outline'

const props = defineProps({
  toast: { type: Object, required: true }
})

defineEmits(['close'])

const iconComponent = computed(() => {
  const icons = {
    success: CheckCircleIcon,
    error: XCircleIcon,
    warning: ExclamationTriangleIcon,
    info: InformationCircleIcon
  }
  return icons[props.toast.type] || InformationCircleIcon
})

const toastClasses = computed(() => {
  const c = {
    success: 'bg-green-50 border-green-400',
    error: 'bg-red-50 border-red-400',
    warning: 'bg-yellow-50 border-yellow-400',
    info: 'bg-blue-50 border-blue-400'
  }
  return c[props.toast.type] || c.info
})

const iconClasses = computed(() => {
  const c = {
    success: 'text-green-500',
    error: 'text-red-500',
    warning: 'text-yellow-500',
    info: 'text-blue-500'
  }
  return c[props.toast.type] || c.info
})

const textClasses = computed(() => {
  const c = {
    success: 'text-green-800',
    error: 'text-red-800',
    warning: 'text-yellow-800',
    info: 'text-blue-800'
  }
  return c[props.toast.type] || c.info
})

const closeButtonClasses = computed(() => {
  const c = {
    success: 'text-green-600 hover:bg-green-100',
    error: 'text-red-600 hover:bg-red-100',
    warning: 'text-yellow-600 hover:bg-yellow-100',
    info: 'text-blue-600 hover:bg-blue-100'
  }
  return c[props.toast.type] || c.info
})

const progressClasses = computed(() => {
  const c = {
    success: 'bg-green-400',
    error: 'bg-red-400',
    warning: 'bg-yellow-400',
    info: 'bg-blue-400'
  }
  return c[props.toast.type] || c.info
})
</script>

<style scoped>
@keyframes toast-progress {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}
</style>
