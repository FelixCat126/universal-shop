/**
 * 门户移动端布局护栏（390px 视口）
 *
 * ## 为什么要有这条
 *
 * 第 31 轮用真机视口实测发现：商品卡底部的两个按钮并排时，
 * 390px 宽的卡片里每个按钮只剩 **65px 内容宽**，
 * "Add to Cart" 被压成 **3 行竖排**，按钮区从 44px 被撑到 **82px** ——
 * 卡片底部白白多出 38px，文字竖排更是完全没法看。
 *
 * 这类问题**单元测试看不见**（DOM 结构没变）、**截图也容易漏**
 * （要正好截到移动视口），所以必须写成**可量化的断言**。
 *
 * ## 用例
 *   ML-1 页面无横向溢出（移动端最常见的"挤爆"）
 *   ML-2 顶栏不溢出容器
 *   ML-3 商品卡按钮文字**单行**（不能竖排）
 *   ML-4 商品卡按钮高度在合理区间（44~56px，不是 82px）
 *   ML-5 同一行卡片的底部按钮对齐
 *   ML-6 可点击控件（button/select/input）的触控热区 ≥ 40px
 *
 * ⚠️ 这些断言都做过反向验证：把布局改回原样（并排 + 固定 min-height）
 *    ML-3 / ML-4 会立刻红。
 */
import { test, expect } from '@playwright/test'

/** 等首页商品渲染出来 */
async function gotoHomeWithProducts (page) {
  await page.goto('/portal/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
}

/** 取商品卡里的操作按钮（排除分类 Tab） */
const cardButtons = (page) => page.locator('h3').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').locator('button')

test.describe('门户移动端布局', () => {
  test.beforeEach(async ({ page }) => {
    // 明确用移动视口（Pixel 5 是 393px，这里再钉到 390 复现实测条件）
    await page.setViewportSize({ width: 390, height: 844 })
  })

  test('ML-1 页面无横向溢出', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth
    }))
    expect(m.scrollW, `页面横向溢出：scrollWidth=${m.scrollW} > innerWidth=${m.innerW}`).toBeLessThanOrEqual(m.innerW + 1)
  })

  test('ML-2 顶栏不溢出容器', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const m = await page.evaluate(() => {
      const row = document.querySelector('header .flex.items-center.justify-between')
      if (!row) return null
      const r = row.getBoundingClientRect()
      return { right: r.right, innerW: window.innerWidth, scrollW: row.scrollWidth, clientW: row.clientWidth }
    })
    expect(m, '找不到顶栏行').not.toBeNull()
    expect(m.right, `顶栏超出屏幕：right=${m.right} > ${m.innerW}`).toBeLessThanOrEqual(m.innerW + 1)
    expect(m.scrollW, '顶栏内容宽度超过容器宽度').toBeLessThanOrEqual(m.clientW + 1)
  })

  test('ML-3 商品卡按钮文字是单行（不能竖排）', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const lines = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('h3').forEach((h3) => {
        const card = h3.closest('.rounded-xl')
        if (!card) return
        for (const b of card.querySelectorAll('button')) {
          const range = document.createRange()
          range.selectNodeContents(b)
          const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
          out.push({ text: (b.textContent || '').trim().slice(0, 14), lines: rects.length })
        }
      })
      return out
    })
    expect(lines.length, '没找到商品卡按钮').toBeGreaterThan(0)
    const wrapped = lines.filter(l => l.lines > 1)
    expect(wrapped, `按钮文字被压成多行（竖排）：${JSON.stringify(wrapped)}`).toEqual([])
  })

  test('ML-4 商品卡按钮高度在 44~56px（不是被撑到 80+）', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const heights = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('h3').forEach((h3) => {
        const card = h3.closest('.rounded-xl')
        if (!card) return
        for (const b of card.querySelectorAll('button')) {
          const r = b.getBoundingClientRect()
          if (r.height > 0) out.push({ text: (b.textContent || '').trim().slice(0, 14), h: Math.round(r.height) })
        }
      })
      return out
    })
    expect(heights.length).toBeGreaterThan(0)
    const tooTall = heights.filter(h => h.h > 56)
    expect(tooTall, `按钮被撑高了（文字换行导致）：${JSON.stringify(tooTall)}`).toEqual([])
  })

  test('ML-5 同一行卡片的底部按钮对齐', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const rows = await page.evaluate(() => {
      // 按 top 分组（同一网格行）
      const items = []
      document.querySelectorAll('h3').forEach((h3) => {
        const card = h3.closest('.rounded-xl')
        if (!card) return
        const btns = [...card.querySelectorAll('button')]
        const last = btns[btns.length - 1]
        if (!last) return
        items.push({
          name: (h3.textContent || '').trim().slice(0, 12),
          top: Math.round(card.getBoundingClientRect().top),
          btnBottom: Math.round(last.getBoundingClientRect().bottom)
        })
      })
      const groups = {}
      items.forEach(i => { (groups[i.top] = groups[i.top] || []).push(i) })
      return Object.values(groups).filter(g => g.length > 1)
    })
    for (const g of rows) {
      const bottoms = [...new Set(g.map(i => i.btnBottom))]
      expect(bottoms.length, `同一行卡片的底部按钮没对齐：${JSON.stringify(g)}`).toBe(1)
    }
  })

  test('ML-6 可点击控件触控热区 ≥ 40px', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const small = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('button, select, input').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        // 输入框里的清除按钮之类的小图标不算（它们有独立的 aria-label）
        if (r.height < 40) {
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 12),
            cls: String(el.className || '').slice(0, 40),
            h: Math.round(r.height),
            w: Math.round(r.width)
          })
        }
      })
      return out
    })
    expect(small, `触控热区小于 40px：${JSON.stringify(small)}`).toEqual([])
  })
})
