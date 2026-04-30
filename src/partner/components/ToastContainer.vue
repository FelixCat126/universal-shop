<template>
  <Teleport to="body">
    <div
      class="fixed top-3 left-3 right-3 sm:top-4 sm:left-auto sm:right-4 sm:max-w-md z-[9999] pointer-events-none space-y-2"
    >
      <TransitionGroup name="toast" tag="div">
        <ToastItem
          v-for="toast in toasts"
          :key="toast.id"
          :toast="toast"
          class="pointer-events-auto"
          @close="hideToast"
        />
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useToast } from '../composables/useToast.js'
import ToastItem from './ToastItem.vue'

const { toasts, hideToast } = useToast()
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
