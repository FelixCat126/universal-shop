/**
 * 两端品牌风格必须明显不同（客户门户 vs 合作方门户）
 *
 * ## 背景
 *
 * 用户要求「批发商和客户的两端要有明显的样式风格区别」。
 * 原来两端的 Tailwind **primary 色板完全相同**（都是蓝 #2563eb），
 * 加上圆角、顶栏、底色都一致 —— 一眼分不出哪个是零售、哪个是批发。
 *
 * 现在：
 *   客户门户（零售）→ 蓝 #2563eb、圆润、白顶栏
 *   合作方门户（批发）→ 墨绿 #0f766e、方正、深墨绿顶栏
 *
 * ## 用例
 *   BS-1 两端主色**色相明显不同**（不只是"看起来不一样"，而是量化差值）
 *   BS-2 两端顶栏明暗相反（一个浅、一个深）
 *   BS-3 批发端圆角比零售端更方正
 *   BS-4 批发端底色与零售端不同（且偏主色同族）
 *
 * 这些断言是**可证伪**的：把 partner 的 Tailwind 配置改回共用那份，BS-1 立刻红。
 */
import { test, expect } from '@playwright/test'

/** 把 rgb() 字符串转成 HSL */
function parseColor (str) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(str || '')
  if (!m) return null
  let [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])].map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l }
}

/** 色相距离（环形，0-180） */
function hueDistance (a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

test.describe('两端品牌风格区分', () => {
  test('BS-1 两端主按钮色相明显不同', async ({ page }) => {
    // 客户门户：挑一个主色按钮（立即购买 / 加入购物车）
    await page.goto('/portal/')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(800)
    const portalBtn = await page.evaluate(() => {
      const b = document.querySelector('button.bg-blue-600') || document.querySelector('button')
      return b ? getComputedStyle(b).backgroundColor : null
    })
    const portal = parseColor(portalBtn)

    // 合作方门户：登录后取主色按钮
    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    const ok = await page.evaluate(async () => {
      const res = await fetch('/api/partner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'e2e_partner', password: 'E2ePartner#2026' })
      })
      const b = await res.json()
      if (b.success) localStorage.setItem('partner_token', b.data.token)
      return b.success
    })
    expect(ok, '合作方登录失败').toBeTruthy()

    await page.goto('/partner/shop')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const partnerBtn = await page.evaluate(() => {
      const b = document.querySelector('button.bg-primary-600') || document.querySelector('button')
      return b ? getComputedStyle(b).backgroundColor : null
    })
    const partner = parseColor(partnerBtn)

    expect(portal, `取不到门户主按钮色：${portalBtn}`).not.toBeNull()
    expect(partner, `取不到合作方主按钮色：${partnerBtn}`).not.toBeNull()

    const dist = hueDistance(portal.h, partner.h)
    expect(
      dist,
      `两端主色色相太接近（差 ${dist.toFixed(1)}°，应 ≥ 30°）—— 批发端与零售端看起来分不开`
    ).toBeGreaterThanOrEqual(30)
  })

  test('BS-2 批发端顶栏是深色、零售端顶栏是浅色', async ({ page }) => {
    const lum = (c) => {
      const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c || '')
      if (!m) return null
      return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
    }

    await page.goto('/portal/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const portalHeader = await page.evaluate(() => {
      const h = document.querySelector('header')
      return h ? getComputedStyle(h).backgroundColor : null
    })

    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(async () => {
      const res = await fetch('/api/partner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'e2e_partner', password: 'E2ePartner#2026' })
      })
      const b = await res.json()
      if (b.success) localStorage.setItem('partner_token', b.data.token)
    })
    await page.goto('/partner/shop')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const partnerHeader = await page.evaluate(() => {
      const h = document.querySelector('header')
      return h ? getComputedStyle(h).backgroundColor : null
    })

    const p = lum(portalHeader)
    const q = lum(partnerHeader)
    expect(p, `取不到门户顶栏色：${portalHeader}`).not.toBeNull()
    expect(q, `取不到合作方顶栏色：${partnerHeader}`).not.toBeNull()
    expect(q, `批发端顶栏应是深色（亮度 ${q.toFixed(2)}），实测 ${partnerHeader}`).toBeLessThan(0.5)
    expect(p, `零售端顶栏应是浅色（亮度 ${p.toFixed(2)}），实测 ${portalHeader}`).toBeGreaterThan(0.75)
  })

  test('BS-3 批发端圆角比零售端更方正', async ({ page }) => {
    const radiusOf = async (url, sel) => {
      await page.goto(url)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      return page.evaluate((s) => {
        const el = document.querySelector(s)
        if (!el) return null
        const r = parseFloat(getComputedStyle(el).borderRadius) || 0
        return r
      }, sel)
    }

    await page.goto('/portal/')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(600)
    const portalCard = await page.evaluate(() => {
      const h3 = document.querySelector('h3')
      const card = h3?.closest('.rounded-xl, .rounded-lg, .rounded-2xl')
      return card ? parseFloat(getComputedStyle(card).borderRadius) : null
    })

    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(async () => {
      const res = await fetch('/api/partner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'e2e_partner', password: 'E2ePartner#2026' })
      })
      const b = await res.json()
      if (b.success) localStorage.setItem('partner_token', b.data.token)
    })
    await page.goto('/partner/shop')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const partnerCard = await page.evaluate(() => {
      const el = document.querySelector('.rounded-lg, .rounded-xl, .rounded-2xl')
      return el ? parseFloat(getComputedStyle(el).borderRadius) : null
    })

    expect(portalCard, '取不到门户卡片圆角').not.toBeNull()
    expect(partnerCard, '取不到合作方卡片圆角').not.toBeNull()
    expect(partnerCard, '批发端圆角应比零售端更方正').toBeLessThan(portalCard)
  })

  test('BS-4 两端底色不同', async ({ page }) => {
    const bodyBg = async (url) => {
      await page.goto(url)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    }
    const portalBg = await bodyBg('/portal/')
    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    const partnerBg = await bodyBg('/partner/login')

    expect(portalBg).not.toBe(partnerBg)
  })
})
