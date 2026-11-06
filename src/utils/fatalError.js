import { ref } from 'vue'

/**
 * 致命错误（unhandled）状态 —— 三端共用。
 *
 * 问题：Vue 里任何组件渲染时抛错，默认会让整棵子树变成空白，
 * 用户的反应是"白屏了，刷新一下"—— 既不知道出了什么事，也没法继续用。
 *
 * 现在：把这类错误收进这里，由各端的 App.vue 渲染一个友好的兜底页
 * （说明 + 重试按钮 + 错误码），至少让人知道"是出了点问题，刷新试试"。
 *
 * 注意：这不是"吞掉错误" —— 错误依然会打到 console/上报，
 * 这里只是保证**界面不会白屏**。
 */
export const fatalError = ref(null)

/**
 * 记录一个致命错误。
 * @param {Error|string} err
 * @param {string} [info] 附加信息（组件栈等）
 */
export function reportFatalError (err, info) {
  const message = typeof err === 'string' ? err : (err?.message || String(err))
  // 已经报过一次就不再覆盖（避免连续报错把真正的首个错误冲掉）
  if (fatalError.value) return
  fatalError.value = {
    message: String(message || 'unknown error').slice(0, 300),
    info: typeof info === 'string' ? info.slice(0, 300) : undefined,
    at: new Date().toISOString()
  }
  console.error('[fatalError]', err, info)
}

/**
 * 调试钩子：URL 带 ?debug=1 时挂到 window。
 *
 * 现场排查时不用改代码 —— 让用户在控制台执行 __fatalError 就能看到
 * 是不是命中了致命错误兜底、以及错误内容是什么。
 */
if (typeof window !== 'undefined') {
  try {
    if (new URLSearchParams(window.location.search).has('debug')) {
      window.__fatalError = fatalError
    }
  } catch (_) { /* 老浏览器没有 URLSearchParams，忽略 */ }
}

/** 清空（重试时用） */
export function clearFatalError () {
  fatalError.value = null
}
