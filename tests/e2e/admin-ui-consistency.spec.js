/**
 * 后台视觉一致性护栏（第 36 轮"焕新"）
 *
 * ## 为什么要有这条
 *
 * 后台的不整齐不是"某个页面写错了一处"，而是**同一个页面里并存几种写法**：
 *   - 圆角：primary 按钮 4px、default/small 3px（同一页并存）
 *   - 按钮高度：工具栏 32px、表格内 small 24px、partners 的 link 按钮 20px
 *   - 检索控件宽度：每个输入框都是手写内联宽度，共 12 种（200/180/140/150…）
 *   - 翻页区：有的带 is-background（带底色块）、有的没有
 *   - 表头：纯白，与页面底色混在一起
 *
 * 逐页改 class 改不干净（下次新增页面又走样），所以规范落在
 * **CSS 变量 + 全局类**上，这些断言就是防止规范被绕开。
 *
 * ## 用例
 *   UC-1 各页按钮圆角**只有一个值**
 *   UC-2 各页按钮高度只有 28/32 两档（默认/small）
 *   UC-3 检索区控件宽度统一（不随内容长度变化）
 *   UC-4 翻页区统一靠右
 *   UC-5 表头有统一的浅色底（与页面底色区分）
 */
import { test, expect } from '@playwright/test'

const ADMIN_PAGES = [
  '/admin/products',
  '/admin/orders',
  '/admin/users',
  '/admin/partners',
  '/admin/product-categories',
  '/admin/promotions'
]

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(async () => {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'e2e_admin', password: 'E2eAdmin#2026' })
    })
    const b = await res.json()
    if (b.success) {
      localStorage.setItem('admin_token', b.data.token)
      localStorage.setItem('admin_info', JSON.stringify(b.data.admin))
    }
  })
}

test.describe('后台视觉一致性', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginAdmin(page)
  })

  test('UC-1 各页按钮圆角统一为规范值 6px', async ({ page }) => {
    /**
     * ⚠️ 断言的是**具体值**，不只是"唯一"。
     * 第一版只查"只有一种圆角" —— 结果把规范去掉后反而**照样绿**：
     * Element Plus 的默认值（4px/3px）本身也是"只有一种"，
     * 于是护栏根本抓不到规范被移除。这就是**假绿**。
     */
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const radii = await page.evaluate(() => {
        const set = new Set()
        document.querySelectorAll('.el-button').forEach(b => {
          const r = getComputedStyle(b).borderRadius
          if (r) set.add(r)
        })
        return [...set]
      })
      expect(radii.length, `${p} 的按钮圆角有 ${radii.length} 种：${radii.join(', ')}`).toBe(1)
      expect(radii[0], `${p} 的按钮圆角应为 6px（实际 ${radii[0]}）—— 规范被绕开了`).toBe('6px')
    }
  })

  test('UC-2 各页按钮高度只有 28/32 两档', async ({ page }) => {
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const heights = await page.evaluate(() => {
        const set = new Set()
        document.querySelectorAll('.el-button').forEach(b => {
          const h = Math.round(b.getBoundingClientRect().height)
          if (h > 0) set.add(h)
        })
        return [...set].sort((a, b) => a - b)
      })
      const bad = heights.filter(h => h !== 28 && h !== 32)
      expect(bad, `${p} 出现了规范外的高度：${bad.join(', ')}（规范：28/32）`).toEqual([])
    }
  })

  test('UC-3 检索区控件宽度统一', async ({ page }) => {
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const widths = await page.evaluate(() => {
        const fs = document.querySelector('.search-form')
        if (!fs) return null
        const set = new Set()
        fs.querySelectorAll('.el-input, .el-select').forEach(el => {
          set.add(Math.round(el.getBoundingClientRect().width))
        })
        return [...set]
      })
      if (widths === null) continue // 该页没有检索区
      expect(widths.length, `${p} 的检索控件宽度有 ${widths.length} 种：${widths.join(', ')}`).toBe(1)
      expect(widths[0], `${p} 的检索控件宽度应为 180px`).toBe(180)
    }
  })

  test('UC-4 翻页区统一靠右', async ({ page }) => {
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const justify = await page.evaluate(() => {
        const pg = document.querySelector('.el-pagination')
        return pg ? getComputedStyle(pg).justifyContent : null
      })
      if (justify === null) continue // 该页数据不足一页，没有翻页区
      expect(justify, `${p} 的翻页区没有靠右（实际 ${justify}）`).toBe('flex-end')
    }
  })

  test('UC-5 表头有统一浅色底', async ({ page }) => {
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const bg = await page.evaluate(() => {
        const th = document.querySelector('.el-table th.el-table__cell')
        return th ? getComputedStyle(th).backgroundColor : null
      })
      if (bg === null) continue
      expect(bg, `${p} 的表头底色应为 #f8fafc（实际 ${bg}）`).toBe('rgb(248, 250, 252)')
    }
  })
})
