<template>
  <Teleport to="body">
    <div 
      class="fixed top-4 right-4 z-50 space-y-2 pointer-events-none"
      style="z-index: 9999;"
    >
      <TransitionGroup name="toast" tag="div">
        <ToastItem
          v-for="toast in toasts"
          :key="toast.id"
          :toast="toast"
          @close="hideToast"
          class="pointer-events-auto"
        />
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useToast } from '@/composables/useToast'
import ToastItem from './ToastItem.vue'

const { toasts, hideToast } = useToast()
</script>

<style scoped>
/* Toast动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%) scale(0.95);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>