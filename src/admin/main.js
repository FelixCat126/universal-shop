import { createApp } from 'vue'
// Element Plus 样式改为**按需引入**（vite.admin.config.js 的 Components 插件）：
// 整包 CSS 有 350KB 且是渲染阻塞的，登录页用不到那么多。
// JS API（ElMessage 等）的样式由各使用处显式 import。
import { createPinia } from 'pinia'

import router from './router'
import { fetchAndApplyCurrencyUnit } from '../utils/currencyI18n.js'
import App from './App.vue'
import './styles/admin-ui-overrides.css'

// i18n 实例（语言包按需加载，见 src/admin/i18n/index.js）
import i18n, { ensureLocale } from './i18n/index.js'

const app = createApp(App)

// 注册所有Element Plus图标
// 图标不再全局注册：每个 .vue 都已按需 import 自己用到的图标，
// 全局注册会把 290 个图标全打进首屏包（见 vite.admin.config.js 的按需引入说明）。
// Element Plus 组件本身由 unplugin-vue-components 自动按需引入。

// 发版后旧页面持有的 chunk 哈希已失效，动态 import 会失败：自动刷新拉取新资源
// sessionStorage 时间戳节流（60s 内最多刷一次），防止部署异常时无限刷新循环
const CHUNK_RELOAD_KEY = 'admin-chunk-reload-at'
const CHUNK_RELOAD_INTERVAL = 60 * 1000
let chunkReloadAttempted = false

const reloadForStaleChunk = () => {
  if (chunkReloadAttempted) return
  chunkReloadAttempted = true
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
    if (last && Date.now() - last < CHUNK_RELOAD_INTERVAL) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch (e) {
    // sessionStorage 不可用（隐私模式等）时仅靠内存标记兜底
  }
  window.location.reload()
}

const isChunkLoadError = (error) =>
  /dynamically imported module|importing a module script failed|failed to fetch/i.test(error?.message || '')

router.onError((error) => {
  if (isChunkLoadError(error)) {
    reloadForStaleChunk()
    return
  }
  console.error('路由错误:', error)
})

// Vite 预加载失败（link preload / modulepreload）同样走刷新兜底
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForStaleChunk()
})

app.use(createPinia())
// Element Plus 不再整包 app.use —— 组件由 unplugin-vue-components 按需引入
app.use(i18n)
app.use(router)

fetchAndApplyCurrencyUnit(i18n, '').finally(() => {
  // 语言包按需加载：首屏要用哪种语言就先把它拉下来（默认中文已在首屏包里，零等待）
ensureLocale(i18n.global.locale.value).finally(() => {
  app.mount('#app')
})
})