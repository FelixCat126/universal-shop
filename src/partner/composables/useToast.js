import { ref } from 'vue'

const toasts = ref([])
let toastId = 0

export const useToast = () => {
  const showToast = (message, type = 'info', duration = 3000) => {
    const id = ++toastId
    const toast = { id, message, type, duration, visible: true }
    toasts.value.push(toast)
    if (duration > 0) {
      setTimeout(() => hideToast(id), duration)
    }
    return id
  }

  const hideToast = (tid) => {
    const idx = toasts.value.findIndex((t) => t.id === tid)
    if (idx !== -1) {
      toasts.value[idx].visible = false
      setTimeout(() => {
        const i = toasts.value.findIndex((t) => t.id === tid)
        if (i !== -1) toasts.value.splice(i, 1)
      }, 280)
    }
  }

  return {
    toasts,
    showToast,
    hideToast,
    success: (m, d) => showToast(m, 'success', d),
    error: (m, d) => showToast(m, 'error', d),
    warning: (m, d) => showToast(m, 'warning', d),
    info: (m, d) => showToast(m, 'info', d)
  }
}
