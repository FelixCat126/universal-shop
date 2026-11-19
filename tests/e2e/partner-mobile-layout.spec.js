/**
 * 合作方门户移动端布局护栏（390px 视口）
 *
 * ## 为什么要有这条
 *
 * 第 31 轮只给**门户端**加了移动端布局护栏，结果第 32 轮一扫合作方端就抓到三处：
 *   - 语言下拉只有 30px 高（触控目标下限 44px）
 *   - 「管理收货地址」链接只有 16px 高（手机上点不中）
 *   - 「默认」徽标是 10px 字号（手机屏上几乎看不清）
 *
 * 三处都是**同一类问题**（热区/字号），只是上一轮没扫到 partner 端。
 * 所以护栏必须覆盖**每一个前端**，否则同样的问题会换个地方再来一次。
 *
 * ## ⚠️ 一个曾经踩过的坑：**假覆盖**
 *
 * 第一版把登录页也放进页面清单，但 `beforeEach` 里先登录了 ——
 * 已登录状态下访问 `/partner/login` 会被**重定向到 /shop**，
 * 于是登录页**一次都没被真正扫到**，护栏却一直绿。
 * 把登录页的 select 故意改回 30px 验证：护栏依然全绿 → 确认是假覆盖。
 *
 * 现在按"未登录可见"与"需要登录"分两组扫：
 *   - 登录页在**未登录**状态下扫
 *   - 其余页面登录后再扫
 *
 * ## 用例
 *   PL-1 合作方各页面无横向溢出
 *   PL-2 可点击控件触控热区 ≥ 40px
 *   PL-3 正文字号不小于 11px
 *   PL-4 语言切换入口在移动端**依然存在**（不能为了塞下就把功能藏掉）
 */
import { test, expect } from '@playwright/test'

/** 未登录就能看的页面（必须在这个状态下扫，否则会被重定向） */
const PUBLIC_PAGES = ['/partner/login']
/** 需要登录才能看的页面 */
const AUTH_PAGES = ['/partner/shop', '/partner/orders', '/partner/addresses', '/partner/password']

/** 合作方账号（与 tests/e2e/start-test-server.mjs 造的账号一致） */
const PARTNER_LOGIN = 'e2e_partner'
const PARTNER_PASS = 'E2ePartner#2026'

/**
 * 登录合作方 —— 走**真实表单**（与 partner-order.spec.js 一致）。
 * 不直接调 API：登录接口有失败次数限制，测试里反复直调很容易把自己锁在门外。
 */
async function loginPartner (page) {
  await page.goto('/partner/login')
  await page.getByPlaceholder('请输入登录名').fill(PARTNER_LOGIN)
  await page.getByPlaceholder('请输入密码').fill(PARTNER_PASS)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL(/\/shop/, { timeout: 30_000 })
}

/**
 * 扫一批页面的触控热区，返回不达标项的描述列表。
 * @param {import('@playwright/test').Page} page
 * @param {string[]} paths
 * @param {string} label 出现在报错里的分组名
 */
async function scanHotTargets (page, paths, label) {
  const problems = []
  for (const p of paths) {
    await page.goto(p)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(900)
    const small = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('button, select, input, a[href]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.opacity === '0') return
        const isToggle = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')
        const isControl = ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)
        const min = isToggle ? 20 : (isControl ? 40 : 32)
        if (r.height < min) {
          out.push(el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 10) + ':' + Math.round(r.height) + '(需≥' + min + ')')
        }
      })
      return out
    })
    small.forEach(x => problems.push(label + ' ' + p + ' → ' + x))
  }
  return problems
}

/** 扫一批页面的字号，返回过小项 */
async function scanTinyFonts (page, paths, label) {
  const problems = []
  for (const p of paths) {
    await page.goto(p)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(900)
    const tiny = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('*').forEach((el) => {
        if (!el.childElementCount && el.textContent && el.textContent.trim()) {
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs && fs < 11) out.push(fs + 'px:' + el.textContent.trim().slice(0, 10))
        }
      })
      return out
    })
    tiny.forEach(x => problems.push(label + ' ' + p + ' → ' + x))
  }
  return problems
}

/** 扫一批页面的横向溢出 */
async function scanOverflow (page, paths, label) {
  const problems = []
  for (const p of paths) {
    await page.goto(p)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(900)
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth
    }))
    if (m.scrollW > m.innerW + 1) {
      problems.push(label + ' ' + p + ' → ' + m.scrollW + ' > ' + m.innerW)
    }
  }
  return problems
}

test.describe('合作方门户移动端布局', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // ⚠️ 这里**不要**登录：登录后访问 /partner/login 会被重定向，
    //    登录页就永远扫不到（第一版就踩了这个坑，见文件头）。
  })

  test('PL-1 各页面无横向溢出', async ({ page }) => {
    const problems = await scanOverflow(page, PUBLIC_PAGES, '[未登录]')
    await loginPartner(page)
    problems.push(...await scanOverflow(page, AUTH_PAGES, '[已登录]'))
    expect(problems, `横向溢出：\n${problems.join('\n')}`).toEqual([])
  })

  test('PL-2 可点击控件触控热区 ≥ 40px', async ({ page }) => {
    const problems = await scanHotTargets(page, PUBLIC_PAGES, '[未登录]')
    await loginPartner(page)
    problems.push(...await scanHotTargets(page, AUTH_PAGES, '[已登录]'))
    expect(problems, `触控热区不达标：\n${problems.join('\n')}`).toEqual([])
  })

  test('PL-3 正文字号不小于 11px', async ({ page }) => {
    const problems = await scanTinyFonts(page, PUBLIC_PAGES, '[未登录]')
    await loginPartner(page)
    problems.push(...await scanTinyFonts(page, AUTH_PAGES, '[已登录]'))
    expect(problems, `字号过小（<11px）：\n${problems.join('\n')}`).toEqual([])
  })

  test('PL-4 移动端仍有语言切换入口', async ({ page }) => {
    // 未登录的登录页也要有（那里是独立的一套下拉，不共用 App.vue）
    await page.goto('/partner/login')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    const onLogin = await page.evaluate(() => {
      const sel = document.querySelector('select')
      return !!sel && sel.offsetHeight > 0
    })
    expect(onLogin, '登录页找不到语言切换下拉 —— 功能入口不能因为塞不下就消失').toBeTruthy()

    await loginPartner(page)
    await page.goto('/partner/shop')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    const onShop = await page.evaluate(() => {
      const sel = document.querySelector('select')
      return !!sel && sel.offsetHeight > 0
    })
    expect(onShop, '登录后的页面找不到语言切换下拉').toBeTruthy()
  })
})
