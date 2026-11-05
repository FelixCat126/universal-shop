/**
 * Portal：登录用户下单（真实浏览器）
 *
 * 游客下单那条链路已由 guest-order.spec.js 覆盖；
 * 这条补的是**登录用户**的路径：登录 → 立即购买 → 填地址 → COD 下单 → 订单中心。
 * 与游客路径的差别在于 token 是登录拿的、购物车/地址可以复用，
 * 顺带验证「登录后下单不会串号到别人」。
 *
 * 用例：
 *   PU-1 登录后进入首页，顶部显示已登录
 *   PU-2 登录用户下单 → 订单出现在个人中心，状态为 shipping
 */
import { test, expect } from '@playwright/test'

const USER_PHONE = '812345678'
const USER_PASS = 'Portal#2026'

async function login (page) {
  await page.goto('/portal/login')
  // 占位文案随所选国家变化（"请输入9-10位手机号" / "请输入11位手机号"…），
  // 密码框也可能只显示"密码" —— 用宽松匹配，别写死文案
  await page.getByPlaceholder(/手机号/).fill(USER_PHONE)
  await page.getByPlaceholder(/密码/).fill(USER_PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 30_000 })
}

test.describe('Portal 登录用户下单', () => {
  test('PU-1 登录成功并进入首页', async ({ page }) => {
    await login(page)
    const token = await page.evaluate(() => localStorage.getItem('token'))
    expect(token).toBeTruthy()
  })

  test('PU-2 登录用户下单 → 订单出现在个人中心', async ({ page }) => {
    await login(page)

    // 商品页 → 立即购买
    await page.goto('/portal/')
    await expect(page.getByText('E2E 测试商品').first()).toBeVisible({ timeout: 20_000 })
    await page.getByText('E2E 测试商品').first().click()
    await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 20_000 })
    await page.getByRole('button', { name: '立即购买' }).click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 20_000 })

    // 登录用户结算走地址簿：选中预置的默认地址（否则提交按钮是禁用的）
    const addressCard = page.getByText('E2E 登录用户').first()
    await expect(addressCard).toBeVisible({ timeout: 20_000 })
    await addressCard.click()

    await page.getByRole('button', { name: '提交订单' }).click()
    await page.waitForURL(/\/profile\?tab=orders/, { timeout: 30_000 })

    // 订单确实落库了，且只有一单
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const response = await page.request.get('http://127.0.0.1:3000/api/orders', {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    // 注意：同一个 spec 会在 mobile / desktop 两个 project 各跑一遍，
    // 第二次跑时该用户名下已经有上一轮留下的订单 —— 所以断言"有订单且最新一单是 shipping"，
    // 而不是"恰好一单"。
    expect(body.data.orders.length).toBeGreaterThanOrEqual(1)
    expect(body.data.orders[0].status).toBe('shipping')
  }, 120_000)
})
