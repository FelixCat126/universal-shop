/**
 * 布局护栏：中间宽度 + 管理端表格（��� 58 轮）
 * ==============================================
 *
 * ## 为什么补这两块
 *
 * 现有的布局护栏各管一段：
 *   - `portal-mobile-layout` → 手机宽度（393）
 *   - `admin-desktop-layout` → 桌面宽度（1280）
 *
 * **中间宽度（768 / 1024）是盲区**：平板、13 寸小笔记本、分屏窗口都在这个区间。
 * 而它恰恰最容易坏 —— 桌面断点下"挤一挤就过去了"，到了 1024 就挤不下了。
 *
 * 另一块盲区：**管理端表格的"最后一列被右侧固定列压住"**。
 * 页面本身没有横向溢出（AD-1 查的是页面级），所以老护栏查不出来，
 * 但运营看到的是"创建时间那列只剩一条缝"，像是坏了。
 *
 * ## 用例
 *
 *   IL-1 中间宽度（768 / 1024）下，门户各页面**不横向溢出**
 *   IL-2 中间宽度（768 / 1024）下，管理端各页面**不横向溢出**
 *   IL-3 桌面 1280 下，商品表与订单表**不需要横向滚动**（没有列被固定列压住）
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = { username: 'e2e_admin', password: 'E2eAdmin#2026' }

/** 门户页面（登录态用不到的也要覆盖） */
const PORTAL_PAGES = [
  '/portal/',
  '/portal/products/2',
  '/portal/cart',
  '/portal/checkout',
  '/portal/login',
  '/portal/register'
]

/** 管理端页面 */
const ADMIN_PAGES = [
  '/admin/dashboard',
  '/admin/products',
  '/admin/orders',
  '/admin/after-sales',
  '/admin/promotions',
  '/admin/coupons',
  '/admin/categories'
]

/** 页面级横向溢出（px） */
async function pageOverflowX (page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth - doc.clientWidth
  })
}

/**
 * 管理端主区域的横向溢出（px）。
 *
 * 为什么不能只看 documentElement.scrollWidth：
 * 管理端的 `.main-content` 是 `overflow: auto` —— 页面级永远不溢出，
 * 任何超宽内容都被它**内部**吸收成横向滚动条。
 * 那样查出来的永远是 0 → 一条**永远绿**的护栏（比没有更危险）。
 *
 * 正确���判据：主区域自己**不该需要**横向滚动。
 * （表格自己的横向滚动是正常的 —— 它在表格容器内部，不在主区域。）
 */
async function adminMainOverflowX (page) {
  return page.evaluate(() => {
    const main = document.querySelector('.main-content') || document.querySelector('main')
    if (!main) return 0
    return main.scrollWidth - main.clientWidth
  })
}

/** 注入管理员会话 */
async function loginAdmin (page) {
  const res = await page.request.post('/api/admin/login', { data: ADMIN_USER })
  expect(res.status(), '管理员登录失败').toBe(200)
  const token = (await res.json()).data.token
  await page.addInitScript((t) => {
    localStorage.setItem('admin_token', t)
    localStorage.setItem('admin_info', JSON.stringify({ id: 1, username: 'admin', role: 'super_admin' }))
  }, token)
}

test.describe('中间宽度与表格布局', () => {
  for (const width of [768, 1024]) {
    test(`IL-1 ${width}px：门户各页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      for (const p of PORTAL_PAGES) {
        await page.goto(p)
        await page.waitForLoadState('domcontentloaded')
        await page.waitForTimeout(600)
        const overflow = await pageOverflowX(page)
        expect(
          overflow,
          `${p} 在 ${width}px 宽下横向溢出 ${overflow}px —— 内容比视口还宽`
        ).toBeLessThanOrEqual(0)
      }
    })

    test(`IL-2 ${width}px：管理端各页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await loginAdmin(page)
      for (const p of ADMIN_PAGES) {
        await page.goto(p)
        await page.waitForLoadState('domcontentloaded')
        await page.waitForTimeout(800)
        const overflow = await adminMainOverflowX(page)
        expect(
          overflow,
          `${p} 在 ${width}px 宽下主区域横向溢出 ${overflow}px —— 内容比主区域还宽`
        ).toBeLessThanOrEqual(0)
      }
    })
  }

  test('IL-3 桌面 1280：商品表与订单表不需要横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)

    for (const p of ['/admin/products', '/admin/orders']) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1200)

      const tables = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('.el-table').forEach(t => {
          const wrap = t.querySelector('.el-scrollbar__wrap') || t.querySelector('.el-table__body-wrapper')
          if (!wrap) return
          out.push({ scrollW: wrap.scrollWidth, clientW: wrap.clientWidth })
        })
        return out
      })

      expect(tables.length, `${p} 应有表格`).toBeGreaterThan(0)
      for (const t of tables) {
        expect(
          t.scrollW,
          `${p}：表格宽 ${t.scrollW}px 超过容器 ${t.clientW}px —— ` +
          '右侧固定列会压住最后一列（运营看到的是"少了一列"而不是"可以横向滚动"）'
        ).toBeLessThanOrEqual(t.clientW + 1)
      }
    }
  })
})
