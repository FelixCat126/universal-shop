import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'
import enUS from './en-US.js'
import thTH from './th-TH.js'

export default createI18n({
  legacy: false,
  locale: typeof localStorage !== 'undefined'
    ? (localStorage.getItem('partner-locale') || 'zh-CN')
    : 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'th-TH': thTH
  }
})
