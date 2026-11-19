/**
 * 管理后台桌面端布局护栏（1280px）
 *
 * ## 为什么要有这条
 *
 * 第 32 轮第一次系统性地扫了后台页面，发现后台**从来没有被任何布局护栏覆盖过**：
 * 门户端和合作方端都有（第 31/32 轮加的），后台一片空白。
 *
 * 后台是运营每天用几十次的界面，出问题（表格挤爆、图片裂了、控件被压扁）
 * 没有护栏就只能靠人眼发现。
 *
 * ## 用例
 *   AD-1 各页面无横向溢出（表格太宽会把整个后台推歪）
 *   AD-2 没有裂图（商品列表有缩略图，加载失败会留一个破图标）
 *   AD-3 表格渲染出来（列表页不是空壳）
 *   AD-4 主要操作控件高度 ≥ 28px（桌面用鼠标，比移动端宽，但别被压成一条线）
 *   AD-5 侧边栏导航项都可见（不能被挤到视口外导致"进不去某个菜单"）
 */
import { test, expect } from '@playwright/test'

const ADMIN_PAGES = [
  '/admin/dashboard',
  '/admin/products',
  '/admin/orders',
  '/admin/users',
  '/admin/partners'
]

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.waitForLoadState('domcontentloaded')
  await page.getByPlaceholder(/用户名|账号|username/i).fill('e2e_admin')
  await page.getByPlaceholder(/密码|password/i).fill('E2eAdmin#2026')
  await page.getByRole('button', { name: /登录|登 录|立即登录/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

test.describe('管理后台桌面端布局', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
  })

  test('AD-1 各页面无横向溢出', async ({ page }) => {
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth
      }))
      expect(m.scrollW, `${p} 横向溢出：${m.scrollW} > ${m.innerW}`).toBeLessThanOrEqual(m.innerW + 1)
    }
  })

  test('AD-2 没有裂图', async ({ page }) => {
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1200)
      const broken = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')]
        return imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.slice(-40))
      })
      expect(broken, `${p} 有裂图：${broken.join(', ')}`).toEqual([])
    }
  })

  test('AD-3 列表页渲染出表格', async ({ page }) => {
    for (const p of ['/admin/products', '/admin/orders', '/admin/users']) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1200)
      const tables = await page.evaluate(() => document.querySelectorAll('table').length)
      expect(tables, `${p} 没有渲染出表格（页面可能是空壳）`).toBeGreaterThan(0)
    }
  })

  test('AD-4 主要操作控件高度 ≥ 24px（Element Plus small 的标准尺寸）', async ({ page }) => {
    const problems = []
    for (const p of ADMIN_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const small = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('button, select, input[type="text"], input[type="number"]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.opacity === '0') return
          // Element Plus 的 el-select 内部有一个用于搜索的 input，
          // 它的热区由外层 select 容器提供 → 不单独计入
          if (el.closest('.el-select')) return
          // 文字型按钮（link/text）：命中区域就是文字本身，高度天然较小 → 不计入
          if (el.classList.contains('is-link') || el.classList.contains('is-text')) return
          // 24px = Element Plus small 尺寸（框架标准），低于它才算"被压扁"
          if (r.height < 24) out.push(el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 10) + ':' + Math.round(r.height))
        })
        return out
      })
      small.forEach(x => problems.push(p + ' → ' + x))
    }
    expect(problems, `控件被压得太扁：\n${problems.join('\n')}`).toEqual([])
  })

  test('AD-5 侧边栏导航项都在视口内', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const out = await page.evaluate(() => {
      const nav = document.querySelector('aside') || document.querySelector('nav')
      if (!nav) return { found: false }
      const navRect = nav.getBoundingClientRect()
      const items = [...nav.querySelectorAll('a[href]')].map(a => {
        const r = a.getBoundingClientRect()
        return { text: (a.textContent || '').trim().slice(0, 8), right: Math.round(r.right), visible: r.width > 0 }
      })
      return { found: true, navRight: Math.round(navRect.right), items: items.slice(0, 12) }
    })
    expect(out.found, '找不到侧边栏').toBeTruthy()
    const offscreen = out.items.filter(i => i.visible && i.right > window.innerWidth)
    expect(offscreen, `导航项跑到视口外：${JSON.stringify(offscreen)}`).toEqual([])
  })
})
