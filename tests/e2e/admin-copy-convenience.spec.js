/**
 * 管理端"一键复制"的护栏（第 60 轮 · 操作便利性）
 * ==================================================
 *
 * ## 为什么订单号要能一键复制
 *
 * 运营每天都要把订单号粘到**快递系统**下单（Kerry / Flash），
 * 再把**物流单号**发给客户（WhatsApp / LINE）。
 * 订单号是 22 位大小写混排（`ORD1779468118144DP4KV7`），
 * 手动框选复制很容易看错（O/0、l/1、V/U）—— 抄错了要退回快递系统改一遍。
 *
 * ## 用例
 *
 *   CP-1 订单号是**可点的复制按钮**（不是一堆普通文字）
 *   CP-2 点一下，剪贴板里就是订单号，且给出"已复制"提示
 *   CP-3 复制失败也要**给提示**（静默失败会让运营拿着空单号去下单）
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = { username: 'e2e_admin', password: 'E2eAdmin#2026' }

async function loginAdmin (page) {
  const res = await page.request.post('/api/admin/login', { data: ADMIN_USER })
  expect(res.status(), '管理员登录失败').toBe(200)
  const token = (await res.json()).data.token
  await page.addInitScript((t) => {
    localStorage.setItem('admin_token', t)
    localStorage.setItem('admin_info', JSON.stringify({ id: 1, username: 'admin', role: 'super_admin' }))
  }, token)
}

test.describe('管理端一键复制', () => {
  test('CP-1/CP-2 订单号可点复制，剪贴板里就是订单号', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await loginAdmin(page)

    await page.goto('/admin/orders')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.order-no', { timeout: 20_000 })

    // 订单号必须是一个**可点的按钮**（普通 div 没法用键盘，也没法提示"可复制"）
    const orderNoBtn = page.locator('button.order-no').first()
    await expect(orderNoBtn, '订单号应该是可点击复制的按钮').toBeVisible()
    await expect(orderNoBtn).toHaveAttribute('title', /复制订单号|Copy order number/i)

    const expected = (await orderNoBtn.innerText()).trim()
    expect(expected.length, '订单号不该是空的').toBeGreaterThan(8)

    await orderNoBtn.click()

    // 提示要有（运营要确认"真的复制了"）
    await expect(page.locator('.el-message').first()).toBeVisible({ timeout: 5_000 })

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip.trim(), '剪贴板里的内容应与订单号一致').toBe(expected)
  })

  test('CP-3 复制失败时也要给提示（不能静默失败）', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await loginAdmin(page)

    await page.goto('/admin/orders')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.order-no', { timeout: 20_000 })

    /**
     * 把**两条**复制路径都打掉，模拟"复制不了"：
     *   ① navigator.clipboard（权限被拒 / 非安全上下文）
     *   ② document.execCommand（兜底路径也失败）
     *
     * ⚠️ 只打掉 ① 是不够的：兜底路径会**成功**，
     * 于是测试看到的是"复制成功"的提示 —— 这条护栏就变成永远绿的了。
     */
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get () {
          return {
            writeText: () => Promise.reject(new Error('denied')),
            readText: () => Promise.reject(new Error('denied'))
          }
        }
      })
      document.execCommand = () => false
    })
    await page.reload()
    await page.waitForSelector('.order-no', { timeout: 20_000 })

    await page.locator('button.order-no').first().click()

    const msg = page.locator('.el-message').first()
    await expect(msg, '复制失败也必须给提示 —— 静默失败会让运营拿着空单号去下单').toBeVisible({ timeout: 5_000 })
    await expect(msg, '必须是「复制失败」的提示，而不是「已复制」').toHaveText(/复制失败|Copy failed|คัดลอกไม่สำเร็จ/i)
  })
})
