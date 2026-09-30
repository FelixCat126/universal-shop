import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { MotionPlugin } from '@vueuse/motion'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { registerMotionParallax } from './composables/useScrollParallax.js'
import './style.css'

// 门户端应用启动

const app = createApp(App)
const pinia = createPinia()

// 使用Pinia状态管理
app.use(pinia)

// 使用国际化
app.use(i18n)

// 使用路由
app.use(router)

// 使用动画（弹簧/视差/手势）
app.use(MotionPlugin)
registerMotionParallax(app)

/**
 * 全局 v-observe-visibility 指令：IntersectionObserver 实现懒加载/入场动画
 *
 * 用法：
 *   <div v-observe-visibility="onVisible" />  // 进入视口触发
 *   <div v-observe-visibility.once="onVisible" />  // 只触发一次
 *
 * 默认行为：添加 is-visible class，配合 CSS 使用
 * 0 依赖，浏览器原生 IntersectionObserver。
 */
const observeVisibilityDirective = {
  mounted (el, binding) {
    const once = binding.modifiers.once
    const callback = typeof binding.value === 'function' ? binding.value : null

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (callback) callback(entry)
            else el.classList.add('is-visible')
            if (once) io.disconnect()
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )
    io.observe(el)
    el.__io__ = io
  },
  unmounted (el) {
    if (el.__io__) {
      el.__io__.disconnect()
      delete el.__io__
    }
  }
}
app.directive('observe-visibility', observeVisibilityDirective)

/**
 * 前端错误兜底：发新版后浏览器仍缓存旧 index.html，引用已不存在的旧 chunk，
 * 路由懒加载/预加载动态 import 会失败。检测到后整页刷新拉取新资源；
 * sessionStorage 记录上次刷新时间，10 秒内最多刷新一次，防止刷新循环。
 */
const CHUNK_RELOAD_KEY = 'portal:last-chunk-reload'

const isChunkLoadError = (err) => {
  const msg = String(err?.message || err || '')
  return /dynamically imported module|Importing a module script failed|error loading/i.test(msg)
}

router.onError((err) => {
  if (!isChunkLoadError(err)) return
  const now = Date.now()
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
  if (now - last < 10000) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
  window.location.reload()
})

window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

app.mount('#app')

// 应用已挂载到DOM
