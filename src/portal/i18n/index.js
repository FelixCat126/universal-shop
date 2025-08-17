import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'
import thTH from './th-TH.js'
import enUS from './en-US.js'

const messages = {
  'zh-CN': zhCN,
  'th-TH': thTH,
  'en-US': enUS
}

const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('language') || 'zh-CN', // 默认中文
  fallbackLocale: 'zh-CN',
  messages
})

// 添加语言切换监听
window.addEventListener('storage', (e) => {
  if (e.key === 'language' && e.newValue) {
    i18n.global.locale.value = e.newValue
  }
})

export default i18n