import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router.js'
import i18n, { ensureLocale } from './i18n/index.js'
import { reportFatalError } from '../utils/fatalError.js'
import './style.css'

const app = createApp(App)

// 未捕获的组件错误：收进兜底页，别让用户对着白屏
app.config.errorHandler = (err, instance, info) => {
  reportFatalError(err, info)
}

app.use(createPinia())
app.use(i18n)
app.use(router)
// 语言包按需加载：首屏要用哪种语言先拉下来（默认中文已在首屏包里，零等待）
ensureLocale(i18n.global.locale.value).finally(() => {
  app.mount('#app')
})
