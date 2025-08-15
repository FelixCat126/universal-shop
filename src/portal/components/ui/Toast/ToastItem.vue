<template>
  <div
    :class="[
      'min-w-80 max-w-md p-4 rounded-lg shadow-strong border-l-4 backdrop-blur-sm',
      'transform transition-all duration-300 ease-in-out',
      toastClasses,
      { 'opacity-0 scale-95': !toast.visible }
    ]"
  >
    <div class="flex items-start space-x-3">
      <!-- 图标 -->
      <div class="flex-shrink-0">
        <component 
          :is="iconComponent" 
          :class="['w-5 h-5', iconClasses]"
        />
      </div>
      
      <!-- 内容 -->
      <div class="flex-1 min-w-0">
        <p :class="['text-sm font-medium', textClasses]">
          {{ toast.message }}
        </p>
      </div>
      
      <!-- 关闭按钮 -->
      <button
        @click="$emit('close', toast.id)"
        :class="['flex-shrink-0 p-1 rounded-full hover:bg-opacity-20 transition-colors', closeButtonClasses]"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>
    
    <!-- 进度条 -->
    <div 
      v-if="toast.duration > 0"
      class="mt-2 h-1 bg-black bg-opacity-10 rounded-full overflow-hidden"
    >
      <div 
        :class="['h-full rounded-full transition-all ease-linear', progressClasses]"
        :style="{ 
          width: '100%',
          animation: `toast-progress ${toast.duration}ms linear forwards`
        }"
      ></div>
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
  toast: {
    type: Object,
    required: true
  }
})

defineEmits(['close'])

// 根据类型选择图标
const iconComponent = computed(() => {
  const icons = {
    success: CheckCircleIcon,
    error: XCircleIcon,
    warning: ExclamationTriangleIcon,
    info: InformationCircleIcon
  }
  return icons[props.toast.type] || InformationCircleIcon
})

// Toast样式类
const toastClasses = computed(() => {
  const classes = {
    success: 'bg-green-50 border-green-400',
    error: 'bg-red-50 border-red-400',
    warning: 'bg-yellow-50 border-yellow-400',
    info: 'bg-blue-50 border-blue-400'
  }
  return classes[props.toast.type] || classes.info
})

// 图标样式类
const iconClasses = computed(() => {
  const classes = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400'
  }
  return classes[props.toast.type] || classes.info
})

// 文本样式类
const textClasses = computed(() => {
  const classes = {
    success: 'text-green-800',
    error: 'text-red-800',
    warning: 'text-yellow-800',
    info: 'text-blue-800'
  }
  return classes[props.toast.type] || classes.info
})

// 关闭按钮样式类
const closeButtonClasses = computed(() => {
  const classes = {
    success: 'text-green-500 hover:bg-green-200',
    error: 'text-red-500 hover:bg-red-200',
    warning: 'text-yellow-500 hover:bg-yellow-200',
    info: 'text-blue-500 hover:bg-blue-200'
  }
  return classes[props.toast.type] || classes.info
})

// 进度条样式类
const progressClasses = computed(() => {
  const classes = {
    success: 'bg-green-400',
    error: 'bg-red-400',
    warning: 'bg-yellow-400',
    info: 'bg-blue-400'
  }
  return classes[props.toast.type] || classes.info
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