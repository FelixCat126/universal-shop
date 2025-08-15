import { ref } from 'vue'

// 全局toast状态
const toasts = ref([])
let toastId = 0

export const useToast = () => {
  // 显示toast
  const showToast = (message, type = 'info', duration = 3000) => {
    const id = ++toastId
    const toast = {
      id,
      message,
      type,
      duration,
      visible: true
    }
    
    toasts.value.push(toast)
    
    // 自动隐藏
    if (duration > 0) {
      setTimeout(() => {
        hideToast(id)
      }, duration)
    }
    
    return id
  }

  // 隐藏toast
  const hideToast = (id) => {
    const index = toasts.value.findIndex(toast => toast.id === id)
    if (index !== -1) {
      toasts.value[index].visible = false
      // 延迟移除，等待动画完成
      setTimeout(() => {
        toasts.value.splice(index, 1)
      }, 300)
    }
  }

  // 清除所有toast
  const clearToasts = () => {
    toasts.value.forEach(toast => {
      toast.visible = false
    })
    setTimeout(() => {
      toasts.value.splice(0)
    }, 300)
  }

  // 便捷方法
  const success = (message, duration) => showToast(message, 'success', duration)
  const error = (message, duration) => showToast(message, 'error', duration)
  const warning = (message, duration) => showToast(message, 'warning', duration)
  const info = (message, duration) => showToast(message, 'info', duration)

  return {
    toasts,
    showToast,
    hideToast,
    clearToasts,
    success,
    error,
    warning,
    info
  }
}