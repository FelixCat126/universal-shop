/**
 * 手机端护栏（第 59 轮 · 自适应手机浏览器）
 * ==========================================
 *
 * ## iOS 聚焦自动放大（这一轮的主线）
 *
 * iOS Safari 对**字号小于 16px 的文本输入框**会在聚焦时自动放大页面
 * —— 这是 Safari 自己的行为，网页改不了它的阈值，只能把字号做上去。
 *
 * 后果（用户视角）：
 *   - 登录/注册/结算页**一点输入框**，整页被放大、布局错位
 *   - 键盘弹起后输入框被顶出可视区
 *   - 放大状态会保持到用户手动缩小 —— 后面几屏都是坏的
 *
 * 对手机流量占大头的泰国商城，这发生在**转化漏斗最前面**。
 *
 * ## 用例
 *
 *   MZ-1 手机宽度下，门户各页面的**文本输入框字号 ≥ 16px**
 *   MZ-2 手机宽度下，合作方端同样 ≥ 16px
 *   MZ-3 三端的 viewport meta 都带 **viewport-fit=cover**（iPhone 安全区）
 *
 * ## 为什么只查"文本输入框"
 *
 * iOS 只对**文字录入类**控件聚焦放大（text/tel/email/password/number/search/url/textarea）。
 * select 会拉起系统选择器、checkbox/radio 不放大 —— 它们字号小没关系，
 * 混进来查只会让护栏变成噪声。
 */
import { test, expect } from '@playwright/test'

const MOBILE_WIDTH = 393
const MOBILE_HEIGHT = 851

/** 会触发 iOS 聚焦放大的控件 */
const TEXT_ENTRY = "input[type='text'], input[type='tel'], input[type='email'], input[type='password'], input[type='number'], input[type='search'], input[type='url'], textarea"

const PORTAL_PAGES = [
  '/portal/',
  '/portal/products/2',
  '/portal/cart',
  '/portal/checkout',
  '/portal/login',
  '/portal/register',
  '/portal/forgot-password'
]

/** 取页面上所有文本输入框的计算字号 */
async function textInputFontSizes (page) {
  return page.evaluate((sel) => {
    const out = []
    document.querySelectorAll(sel).forEach(el => {
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (!fs) return
      out.push({
        fontSize: fs,
        tag: el.tagName,
        type: el.type || '',
        placeholder: (el.placeholder || '').slice(0, 16),
        cls: String(el.className).slice(0, 44)
      })
    })
    return out
  }, TEXT_ENTRY)
}

test.describe('手机端自适应', () => {
  test('MZ-1 门户文本输入框字号 ≥ 16px（否则 iOS 聚焦会放大整页）', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT })

    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)

      const inputs = await textInputFontSizes(page)
      const tooSmall = inputs.filter(i => i.fontSize < 16)
      expect(
        tooSmall.length,
        `${p}：${tooSmall.length} 个输入框字号 < 16px（iOS 聚焦时会自动放大整页）：` +
        tooSmall.map(i => `${i.tag}[${i.type}] ${i.fontSize}px "${i.placeholder}"`).join('；')
      ).toBe(0)
    }
  })

  test('MZ-2 合作方端文本输入框字号 ≥ 16px', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT })

    // 登录页（未登录也能看）
    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    let inputs = await textInputFontSizes(page)
    expect(
      inputs.filter(i => i.fontSize < 16).length,
      '合作方登录页的输入框字号 < 16px'
    ).toBe(0)

    // 登录后的页面
    await page.getByPlaceholder('请输入登录名').fill('e2e_partner')
    await page.getByPlaceholder('请输入密码').fill('E2ePartner#2026')
    await page.getByRole('button', { name: /登录/ }).click()
    await page.waitForURL(/\/shop/, { timeout: 30_000 })

    /**
     * 订货清单里的**数量输入框**是 text-sm（14px）——
     * 而清单空着的时候它根本不在页面上（不打开清单就查不到），
     * 所以这里必须**加一件商品并打开清单**，且**就地检查**（别跳页，跳了抽屉就收起了）。
     */
    await page.goto('/partner/shop')
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '加入清单' }).first().click()
    await expect(page.getByText('已加入清单').first()).toBeVisible({ timeout: 15_000 })
    await page.getByText('订货清单').first().click()
    await page.waitForTimeout(900)

    inputs = await textInputFontSizes(page)
    expect(inputs.length, '订货清单里应有输入框（数量框）—— 说明清单没打开，护栏会空跑').toBeGreaterThan(0)
    let tooSmall = inputs.filter(i => i.fontSize < 16)
    expect(
      tooSmall.length,
      `订货清单：${tooSmall.length} 个输入框字号 < 16px：` +
      tooSmall.map(i => `${i.tag}[${i.type}] ${i.fontSize}px "${i.placeholder}"`).join('；')
    ).toBe(0)

    for (const p of ['/partner/orders', '/partner/addresses']) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      inputs = await textInputFontSizes(page)
      tooSmall = inputs.filter(i => i.fontSize < 16)
      expect(
        tooSmall.length,
        `${p}：${tooSmall.length} 个输入框字号 < 16px：` +
        tooSmall.map(i => `${i.tag}[${i.type}] ${i.fontSize}px "${i.placeholder}"`).join('；')
      ).toBe(0)
    }
  })

  test('MZ-3 三端 viewport 都带 viewport-fit=cover', async ({ page }) => {
    for (const p of ['/portal/', '/admin/login', '/partner/login']) {
      const res = await page.request.get(p)
      const html = await res.text()
      const meta = html.match(/<meta[^>]+name="viewport"[^>]*>/i)
      expect(meta, `${p} 没有 viewport meta`).toBeTruthy()
      expect(
        meta[0],
        `${p} 的 viewport 缺 viewport-fit=cover —— iPhone 上内容会钻到刘海/圆角下面`
      ).toMatch(/viewport-fit=cover/i)
    }
  })
})
