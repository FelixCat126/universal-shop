import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'

/**
 * 管理端语言包**按需加载**。
 *
 * 三种语言全打进首屏 = 131KB（zh 34 + th 62 + en 35），
 * 而同一时刻只用一种 —— 中文用户白下 97KB。
 *
 * 默认语言（中文）随首屏走（零等待），其余两种切到时再动态加载。
 */
const LOADERS = {
  'th-TH': () => import('./th-TH.js'),
  'en-US': () => import('./en-US.js')
}

const messages = {
  'zh-CN': zhCN
}

const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('admin-language') || 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages
})

/**
 * 确保某语言的消息已加载（没加载就动态 import）。
 * @param {string} locale
 * @returns {Promise<void>}
 */
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
