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
 * ## 用例
 *   PL-1 合作方各页面无横向溢出
 *   PL-2 可点击控件触控热区 ≥ 40px
 *   PL-3 正文字号不小于 11px
 *   PL-4 语言切换入口在移动端**依然存在**（不能为了塞下就把功能藏掉）
 */
import { test, expect } from '@playwright/test'

const PARTNER_PAGES = ['/partner/shop', '/partner/orders', '/partner/addresses', '/partner/password']

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

test.describe('合作方门户移动端布局', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginPartner(page)
  })

  test('PL-1 各页面无横向溢出', async ({ page }) => {
    for (const p of PARTNER_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        path: location.pathname
      }))
      expect(m.scrollW, `${p} 横向溢出：${m.scrollW} > ${m.innerW}`).toBeLessThanOrEqual(m.innerW + 1)
    }
  })

  test('PL-2 可点击控件触控热区 ≥ 40px', async ({ page }) => {
    const problems = []
    for (const p of PARTNER_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const small = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('button, select, input, a[href]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          if (r.height < 40) {
            out.push(el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 10) + ':' + Math.round(r.height))
          }
        })
        return out
      })
      small.forEach(s => problems.push(p + ' → ' + s))
    }
    expect(problems, `触控热区小于 40px：\n${problems.join('\n')}`).toEqual([])
  })

  test('PL-3 正文字号不小于 11px', async ({ page }) => {
    const problems = []
    for (const p of PARTNER_PAGES) {
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
      tiny.forEach(t => problems.push(p + ' → ' + t))
    }
    expect(problems, `字号过小（<11px）：\n${problems.join('\n')}`).toEqual([])
  })

  test('PL-4 移动端仍有语言切换入口', async ({ page }) => {
    await page.goto('/partner/shop')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    const has = await page.evaluate(() => {
      const sel = document.querySelector('select')
      return !!sel && sel.offsetHeight > 0
    })
    expect(has, '移动端找不到语言切换下拉 —— 功能入口不能因为塞不下就消失').toBeTruthy()
  })
})
