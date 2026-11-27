import { test, expect } from '@playwright/test'

/** 临时巡检：手机视口下的自适应体检 */

const PORTAL = ['/portal/', '/portal/products/2', '/portal/cart', '/portal/checkout', '/portal/login', '/portal/register', '/portal/notifications', '/portal/profile']

test('mobile audit', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 })
  const report = []
  for (const p of PORTAL) {
    await page.goto(p)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)
    const r = await page.evaluate(() => {
      const doc = document.documentElement
      const vw = window.innerWidth
      const out = { path: location.pathname, overflowX: doc.scrollWidth - doc.clientWidth, over: [], small: [], tinyFont: [], covered: [] }
      // ① 横向溢出
      document.querySelectorAll('body *').forEach(el => {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) return
        if (b.right > vw + 2) out.over.push({ tag: el.tagName, cls: String(el.className).slice(0, 36), right: Math.round(b.right) })
      })
      // ② 触控热区（label 提供的热区不算）
      document.querySelectorAll('button, a, [role=button], input[type=checkbox], input[type=radio]').forEach(el => {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) return
        if (b.height >= 40) return
        const lab = el.closest('label')
        if (lab && lab.getBoundingClientRect().height >= 40) return
        out.small.push({ tag: el.tagName, cls: String(el.className).slice(0, 32), h: Math.round(b.height), text: (el.textContent || '').trim().slice(0, 16) })
      })
      // ③ 正文字号
      document.querySelectorAll('p, span, div, li, td, a, button').forEach(el => {
        if (el.children.length) return
        const t = (el.textContent || '').trim()
        if (!t) return
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs && fs < 11) out.tinyFont.push({ cls: String(el.className).slice(0, 30), fs, text: t.slice(0, 18) })
      })
      // ④ 被固定头/尾遮住的可见文字
      const header = document.querySelector('header')
      if (header) {
        const hb = header.getBoundingClientRect()
        document.querySelectorAll('main *, .page-shell *').forEach(el => {
          if (el.children.length) return
          const t = (el.textContent || '').trim()
          if (!t) return
          const b = el.getBoundingClientRect()
          if (b.top < hb.bottom && b.bottom > hb.top && b.height > 0 && b.top >= 0) {
            out.covered.push({ text: t.slice(0, 20), top: Math.round(b.top) })
          }
        })
      }
      out.over = out.over.slice(0, 4); out.small = out.small.slice(0, 6); out.tinyFont = out.tinyFont.slice(0, 4); out.covered = out.covered.slice(0, 4)
      return out
    })
    report.push(r)
  }
  console.log('MOBILE=' + JSON.stringify(report))
})
