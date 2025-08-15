import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import App from './App.vue'
import router from './router'

// 导入语言包
import zhCN from './i18n/zh-CN.js'
import thTH from './i18n/th-TH.js'
import enUS from './i18n/en-US.js'

// 创建i18n实例
const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('admin-language') || 'th-TH',
  fallbackLocale: 'th-TH',
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

app.use(createPinia())
app.use(ElementPlus)
app.use(i18n)
app.use(router)

app.mount('#app')