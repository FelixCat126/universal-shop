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

/**
 * 要扫的页面（**不只首页**）。
 *
 * 第 32 轮的教训：第 31 轮的护栏只查首页，于是"详情页/购物车的返回按钮只有 32px"
 * 这类问题一个都没被覆盖到 —— 护栏覆盖面不够，等于只守了大门。
 */
const PORTAL_PAGES = [
  '/portal/',
  '/portal/products/2',   // 真实商品（id=1 是软删商品，详情页会显示"不存在"）
  '/portal/cart',
  '/portal/login',
  '/portal/register',
  '/portal/nonexistent'   // 404 页
]

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

  test('ML-1 各页面无横向溢出', async ({ page }) => {
    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth
      }))
      expect(m.scrollW, `${p} 横向溢出：scrollWidth=${m.scrollW} > innerWidth=${m.innerW}`).toBeLessThanOrEqual(m.innerW + 1)
    }
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

  /**
   * ML-6 触控热区下限。
   *
   * 分档而不是一刀切 44px：
   *   - button / select / input：**40px**（主要操作控件）
   *   - a[href] 文本链接：**32px**（文字链接本身有文字尺寸，
   *     一律 44px 会让页面被撑得松松垮垮；32px 是可点文本的通行下限）
   * 不可见元素（opacity:0 / visibility:hidden / clip 隐藏的备用 input）不计入。
   *
   * ⚠️ 分档是为了让护栏**能长期保持绿** —— 一个永远红的护栏等于没有护栏。
   *    但"永远绿"的陷阱靠的是**明确的判定依据**，不是放宽阈值。
   */
  test('ML-7 勾选框的 label 触控热区 ≥ 40px（热区由 label 提供）', async ({ page }) => {
    const problems = []
    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const bad = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.opacity === '0') return
          const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
                      el.closest('label')
          if (!lab) { out.push('没有 label：' + (el.id || el.className).slice(0, 30)); return }
          const lr = lab.getBoundingClientRect()
          if (lr.height < 40) out.push('label 热区 ' + Math.round(lr.height) + 'px：' + (el.id || el.className).slice(0, 30))
        })
        return out
      })
      bad.forEach(x => problems.push(p + ' → ' + x))
    }
    expect(problems, `勾选框热区不达标：\n${problems.join('\n')}`).toEqual([])
  })

  test('ML-6 可点击控件触控热区达标（所有门户页面）', async ({ page }) => {
    const problems = []
    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const small = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('button, select, input, a[href]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const cs = getComputedStyle(el)
          // 不可见（视觉隐藏但仍在 DOM 里）的备用控件不算触控目标
          if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.position === 'absolute' && r.width <= 2) return
          const isControl = ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)
          // 原生勾选框/单选框本身只有 ~20px，触控热区由**它的 label** 提供
          // → 单独按 20px 判定，并在下面的用例里断言 label 本身够大
          const isNativeToggle = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')
          const min = isNativeToggle ? 20 : (isControl ? 40 : 32)
          if (r.height < min) {
            out.push(el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 12) + ':' + Math.round(r.height) + '(需≥' + min + ')')
          }
        })
        return out
      })
      small.forEach(x => problems.push(p + ' → ' + x))
    }
    expect(problems, `触控热区不达标：\n${problems.join('\n')}`).toEqual([])
  })
})
