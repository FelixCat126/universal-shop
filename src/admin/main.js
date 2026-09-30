import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import router from './router'
import { fetchAndApplyCurrencyUnit } from '../utils/currencyI18n.js'
import App from './App.vue'
import './styles/admin-ui-overrides.css'

// 导入语言包
import zhCN from './i18n/zh-CN.js'
import thTH from './i18n/th-TH.js'
import enUS from './i18n/en-US.js'

// 创建i18n实例
const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('admin-language') || 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'th-TH': thTH,
    'en-US': enUS
  }
})

const app = createApp(App)

// 注册所有Element Plus图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

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
app.use(ElementPlus)
app.use(i18n)
app.use(router)

fetchAndApplyCurrencyUnit(i18n, '').finally(() => {
  app.mount('#app')
})