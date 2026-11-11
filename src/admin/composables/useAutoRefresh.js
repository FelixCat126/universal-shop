/**
 * 定时自动刷新（管理端）
 *
 * 为什么需要：商家把订单页/面板开着等人下单时，数据**不会自己变** ——
 * 必须手动刷新才看得到新订单。晚回客户一句"我下单了没人理"，就是真金白银的损失。
 *
 * 三个克制点（不然会变成"越用越烦"）：
 *   1. 只在**页面可见**时刷新（切到别的标签页就停 —— 后台标签页刷什么都是浪费）
 *   2. 调用方可以自己再加条件（比如"详情弹窗打开时不刷新"，别打断正在做的操作）
 *   3. 组件卸载时**一定**清掉定时器（否则离开页面还在刷，白耗服务器）
 *
 * @param {Function} fn 要执行的刷新函数（通常是重新拉数据）
 * @param {object} [options]
 * @param {number} [options.intervalMs] 间隔毫秒
 * @param {() => boolean} [options.shouldRefresh] 额外的跳过条件（返回 false 就不刷）
 * @returns {{ start: Function, stop: Function, isRunning: () => boolean }}
 */
import { onMounted, onUnmounted, ref } from 'vue'

export function useAutoRefresh (fn, options = {}) {
  const { intervalMs = 30_000, shouldRefresh = () => true } = options

  const timer = ref(null)
  const running = ref(false)

  const stop = () => {
    if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
    running.value = false
  }

  const start = () => {
    stop()
    if (typeof fn !== 'function') return
    timer.value = setInterval(() => {
      // 页面不可见 → 不刷
      if (typeof document !== 'undefined' && document.hidden) return
      // 调用方的额外条件（比如弹窗打开中）
      if (!shouldRefresh()) return
      try {
        fn()
      } catch {
        // 刷新失败不能让定时器停掉（下一轮还会试）
      }
    }, intervalMs)
    running.value = true
  }

  onMounted(start)
  onUnmounted(stop)

  return { start, stop, isRunning: () => running.value }
}
