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
  locale: localStorage.getItem('language') || 'th-TH', // 默认泰文
  fallbackLocale: 'zh-CN',
  messages
})

export default i18n