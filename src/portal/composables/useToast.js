import { ref } from 'vue'

// 全局toast状态
const toasts = ref([])
let toastId = 0

export const useToast = () => {
  // 显示toast
  /**
   * 显示一个 toast。
   * @param {string} message 文案
   * @param {'info'|'success'|'error'|'warning'} type
   * @param {number} duration 自动消失时间（毫秒）
   * @param {{label: string, onClick: Function}} [action] 可选的操作按钮
   *   （例：删除商品后给一个"撤销"入口 —— 误删了不用重新找一遍）
   */
  const showToast = (message, type = 'info', duration = 3000, action = null) => {
    const id = ++toastId
    const toast = {
      id,
      message,
      type,
      duration,
      action,
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
  // 兼容旧调用方：showError 等价于 error
  const showError = (message, duration) => showToast(message, 'error', duration)

  return {
    toasts,
    showToast,
    hideToast,
    clearToasts,
    success,
    error,
    showError,
    warning,
    info
  }
}