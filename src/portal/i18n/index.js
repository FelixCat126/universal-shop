import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'

/**
 * 语言包**按需加载**。
 *
 * 三种语言全打进首屏 = 92KB（zh 23 + th 44.5 + en 24.4），
 * 而同一时刻只用得到一种 —— 中文用户白下 69KB。
 *
 * 现在：默认语言（中文）随首屏一起走（零等待），
 * 其余两种在**切换到时**再动态加载（一个小 chunk，不影响首屏）。
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
  locale: localStorage.getItem('language') || 'zh-CN', // 默认中文
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

// 添加语言切换监听
window.addEventListener('storage', (e) => {
  if (e.key === 'language' && e.newValue) {
    ensureLocale(e.newValue).then(() => {
      i18n.global.locale.value = e.newValue
    })
  }
})

export default i18n
