/**
 * 合作方登录页的**可读性**护栏（对比度）
 *
 * ## 用户反馈
 *
 * 「白字和白底 logo 在页面上根本看不清楚啊」
 *
 * 实测确认：登录页的 logo 是**白色图标画在 15% 不透明白底上**，
 * 对比度 **1.0**（WCAG AA 要求 4.5:1，图形至少 3:1）→ 等于看不见。
 * 同一页面的语言下拉（白字 + 10% 白底）也是 1.0。
 *
 * ## 为什么要有这条
 *
 * 「深色背景上放半透明白底 + 白字」看起来是常规做法，但在**深色渐变**上
 * 半透明白几乎不产生对比 —— 肉眼觉得"有底"，实际对比度只有 1:1。
 * 这类问题静态看代码发现不了（类名都是正常的），只能靠**真实渲染 + 算对比度**。
 *
 * ## 用例
 *   CT-1 logo 图形 vs 其方块底 ≥ 3:1（图形元素，WCAG 非文本对比度）
 *   CT-2 标题文字 vs 页面实际背景 ≥ 4.5:1
 *   CT-3 副标题文字 vs 页面实际背景 ≥ 4.5:1
 *   CT-4 语言下拉文字 vs 控件底 ≥ 4.5:1
 *   CT-5 登录按钮文字 vs 按钮底 ≥ 4.5:1
 */
import { test, expect } from '@playwright/test'

/** 在页面里算对比度：返回若干元素的结果 */
const CONTRAST_PROBE = () => {
  const lum = (rgb) => {
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb || '')
    if (!m) return null
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3])
  }
  const ratio = (a, b) => {
    const l1 = lum(a); const l2 = lum(b)
    if (l1 == null || l2 == null) return null
    const hi = Math.max(l1, l2); const lo = Math.min(l1, l2)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }
  /**
   * 取元素"实际所处的背景"：
   *   1) 祖先链上第一个**渐变**（background-image）→ 取渐变的第一个色标
   *      （登录页就是深色渐变；只看 background-color 会拿到被渐变盖住的底色 → 误判）
   *   2) 否则取祖先链上第一个非透明 background-color
   */
  const effectiveBg = (el) => {
    let e = el
    while (e && e !== document.documentElement) {
      const cs = getComputedStyle(e)
      const bi = cs.backgroundImage
      if (bi && bi !== 'none' && /gradient/.test(bi)) {
        const m = /rgb\(\s*\d+[,\s]+\d+[,\s]+\d+/.exec(bi)
        if (m) return { color: m[0], from: 'gradient' }
      }
      const bg = cs.backgroundColor
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
        return { color: bg, from: 'bg-color' }
      }
      e = e.parentElement
    }
    return null
  }

  const out = {}
  const logo = document.querySelector('.partner-logo')
  const svg = logo?.querySelector('svg')
  if (logo && svg) {
    out.logo = ratio(getComputedStyle(svg).color, getComputedStyle(logo).backgroundColor)
  }
  const h1 = document.querySelector('h1')
  if (h1) {
    const bg = effectiveBg(h1)
    out.title = bg ? ratio(getComputedStyle(h1).color, bg.color) : null
    out.titleBgFrom = bg?.from
  }
  const sub = h1?.nextElementSibling
  if (sub && sub.tagName === 'P') {
    const bg = effectiveBg(sub)
    out.subtitle = bg ? ratio(getComputedStyle(sub).color, bg.color) : null
  }
  const sel = document.querySelector('select')
  if (sel) {
    out.select = ratio(getComputedStyle(sel).color, getComputedStyle(sel).backgroundColor)
  }
  const submit = document.querySelector('button[type="submit"]')
  if (submit) {
    out.submit = ratio(getComputedStyle(submit).color, getComputedStyle(submit).backgroundColor)
  }
  return out
}

test.describe('合作方登录页可读性', () => {
  test('CT-1~5 关键元素对比度达标', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    // 清掉登录态，确保停在登录页
    await page.evaluate(() => {
      localStorage.removeItem('partner_token')
      localStorage.removeItem('partner_profile')
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)

    const c = await page.evaluate(CONTRAST_PROBE)

    expect(c.logo, '找不到 logo 元素').not.toBeNull()
    expect(c.logo, `logo 图形 vs 方块底对比度 ${c.logo}（图形至少要 3:1）`).toBeGreaterThanOrEqual(3)
    expect(c.title, `标题对比度 ${c.title}（正文至少要 4.5:1）`).toBeGreaterThanOrEqual(4.5)
    expect(c.subtitle, `副标题对比度 ${c.subtitle}`).toBeGreaterThanOrEqual(4.5)
    expect(c.select, `语言下拉对比度 ${c.select}`).toBeGreaterThanOrEqual(4.5)
    expect(c.submit, `登录按钮对比度 ${c.submit}`).toBeGreaterThanOrEqual(4.5)
  })
})
