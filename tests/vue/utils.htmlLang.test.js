/**
 * <html lang> 同步测试
 *
 * 三个端的 index.html 里都写死了 lang="zh-CN"，而界面语言可切（中文/ไทย/English）。
 * 不跟着改的话：屏幕阅读器用中文音读规则念泰文、浏览器的"翻译"提示不出现、
 * 泰文字体回退可能出错 —— 对一个面向泰国市场的商城不是小事。
 *
 *   HL-1 normalizeLang：标准 locale 原样保留
 *   HL-2 normalizeLang：只有语言代码时补上默认地区
 *   HL-3 normalizeLang：空/非法值兜底为 zh-CN
 *   HL-4 syncDocumentLang：写入 <html lang>
 *   HL-5 syncDocumentLang：值没变时不重复写（避免无谓的 DOM 变动）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeLang, syncDocumentLang } from '@/utils/htmlLang.js'

beforeEach(() => {
  document.documentElement.setAttribute('lang', 'zh-CN')
})

describe('<html lang> 同步', () => {
  it('HL-1 标准 locale 原样保留', () => {
    expect(normalizeLang('zh-CN')).toBe('zh-CN')
    expect(normalizeLang('th-TH')).toBe('th-TH')
    expect(normalizeLang('en-US')).toBe('en-US')
  })

  it('HL-2 只有语言代码时补上默认地区', () => {
    expect(normalizeLang('zh')).toBe('zh-CN')
    expect(normalizeLang('th')).toBe('th-TH')
    expect(normalizeLang('en')).toBe('en-US')
    expect(normalizeLang('ZH')).toBe('zh-CN')
  })

  it('HL-3 空/非法值兜底为 zh-CN', () => {
    expect(normalizeLang(null)).toBe('zh-CN')
    expect(normalizeLang(undefined)).toBe('zh-CN')
    expect(normalizeLang('')).toBe('zh-CN')
    expect(normalizeLang('   ')).toBe('zh-CN')
  })

  it('HL-4 syncDocumentLang 写入 <html lang>', () => {
    syncDocumentLang('th-TH')
    expect(document.documentElement.getAttribute('lang')).toBe('th-TH')
    syncDocumentLang('en-US')
    expect(document.documentElement.getAttribute('lang')).toBe('en-US')
  })

  it('HL-5 值没变时不重复写', () => {
    syncDocumentLang('th-TH')
    const el = document.documentElement
    // 换成一个可观察的属性，验证没有再次被赋值
    let written = 0
    const observer = new MutationObserver(() => { written++ })
    observer.observe(el, { attributes: true, attributeFilter: ['lang'] })
    syncDocumentLang('th-TH')
    observer.takeRecords()
    expect(written).toBe(0)
    observer.disconnect()
  })
})
