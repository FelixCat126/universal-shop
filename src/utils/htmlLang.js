/**
 * 让 <html lang> 跟随界面语言。
 *
 * 问题：三个端的 index.html 里都**写死** `lang="zh-CN"`，
 * 而界面语言是可切的（中文/ไทย/English），默认甚至是泰文/英文。
 * 于是浏览器被告知"这是中文"，但屏幕上是一堆泰文 —— 后果有三个：
 *   1. 屏幕阅读器用中文的音读规则念泰文，听起来是乱码；
 *   2. 浏览器的"翻译成我的语言"提示不会正确出现；
 *   3. **字体回退**按 lang 选 —— 泰文的字形（上下标、组合字符）跟拉丁字体
 *      差别很大，lang 写错时泰文可能显示成"豆腐块"或错位。
 *      对一个面向泰国市场的商城，这不是小事。
 *
 * 这里在语言切换时同步 <html lang>，并提供 BCP 47 归一。
 */

/** locale（zh-CN / th-TH / en-US）→ BCP 47 语言标签 */
export function normalizeLang (locale) {
  if (!locale) return 'zh-CN'
  const raw = String(locale).trim()
  if (!raw) return 'zh-CN'
  // 已经带地区就原样用
  if (/^[a-z]{2,3}-[A-Za-z0-9]{2,8}$/.test(raw)) return raw
  // 只有语言代码（zh / th / en）→ 补上默认地区
  const base = raw.toLowerCase()
  const map = { zh: 'zh-CN', th: 'th-TH', en: 'en-US' }
  return map[base] || raw
}

/**
 * 把当前界面语言同步到 <html lang>
 * @param {string} locale vue-i18n 的 locale
 */
export function syncDocumentLang (locale) {
  if (typeof document === 'undefined') return
  const lang = normalizeLang(locale)
  if (document.documentElement.getAttribute('lang') !== lang) {
    document.documentElement.setAttribute('lang', lang)
  }
}
