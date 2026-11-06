import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'

/**
 * 语言包按需加载（与 portal / admin 同一套做法）。
 * 默认语言随首屏走，其余切到时再动态加载。
 */
const LOADERS = {
  'en-US': () => import('./en-US.js'),
  'th-TH': () => import('./th-TH.js')
}

const messages = {
  'zh-CN': zhCN
}

const i18n = createI18n({
  legacy: false,
  locale: typeof localStorage !== 'undefined'
    ? (localStorage.getItem('partner-locale') || 'zh-CN')
    : 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages
})

/** 确保某语言的消息已加载（没加载就动态 import） */
export async function ensureLocale (locale) {
  if (!locale || messages[locale]) return
  const loader = LOADERS[locale]
  if (!loader) return
  try {
    const mod = await loader()
    if (!mod?.default) return
    messages[locale] = mod.default
    i18n.global.setLocaleMessage(locale, mod.default)
  } catch (e) {
    console.warn('语言包加载失败，回退到默认语言', locale, e)
  }
}

export default i18n
