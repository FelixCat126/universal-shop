import { ref } from 'vue'

const toasts = ref([])
let toastId = 0

export const useToast = () => {
  /**
   * 显示一个 toast。
   * @param {string} message 文案
   * @param {'info'|'success'|'error'|'warning'} type
   * @param {number} duration 自动消失时间（毫秒）
   * @param {{label: string, onClick: Function}} [action] 可选的操作按钮
   *   （例：加入清单后给一个「去提交订单」入口 —— 少点两次到结算）
   */
  const showToast = (message, type = 'info', duration = 3000, action = null) => {
    const id = ++toastId
    const toast = { id, message, type, duration, action, visible: true }
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
    success: (m, d, a) => showToast(m, 'success', d, a),
    error: (m, d) => showToast(m, 'error', d),
    warning: (m, d) => showToast(m, 'warning', d),
    info: (m, d) => showToast(m, 'info', d)
  }
}
