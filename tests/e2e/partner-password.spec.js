/**
 * 合作方：自助改密 + 强制改密
 *
 * 之前合作方**完全没有改密途径**（门户没有页面、接口也没有），
 * CSV 批量导入的账号拿到的是运营线下告知的随机初始密码 —— 那个密码会一直有效。
 *
 *   PW-1 强制改密的账号登录 → 被挡在改密页 → 改完才能进订货
 *   PW-2 普通账号：导航里有"改密码"入口 → 改密成功
 */
import { test, expect } from '@playwright/test'

// ⚠️ 改密 E2E 会**真的改掉密码**，所以用独立账号 ——
// 改 e2e_partner 会让后面的合作方 E2E 全部登不上
const PARTNER_LOGIN = 'e2e_partner_pwd'
const PARTNER_PASS = 'E2ePwd#2026'
const TEMP_LOGIN = 'e2e_partner_temp'
const TEMP_PASS = 'E2eTemp#2026'

async function login (page, loginName, password) {
  await page.goto('/partner/login')
  await page.getByPlaceholder('请输入登录名').fill(loginName)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
}

test.describe('合作方改密', () => {
  test('PW-1 强制改密：登录后被挡在改密页，改完才能进订货', async ({ page }) => {
    await login(page, TEMP_LOGIN, TEMP_PASS)

    // 被强制带到改密页
    await page.waitForURL(/\/partner\/password/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible({ timeout: 15_000 })
    // 强制改密提示（用 role=alert 精确定位 —— 页面里还有别的含"初始密码"的文字）
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })

    // 改密
    await page.locator('#pw-current').fill(TEMP_PASS)
    await page.locator('#pw-new').fill('E2eChanged#2026')
    await page.locator('#pw-confirm').fill('E2eChanged#2026')
    await page.getByRole('button', { name: /保存新密码/ }).click()

    // 改完进入订货页
    await page.waitForURL(/\/partner\/shop/, { timeout: 30_000 })
    await expect(page.getByText('加入清单').first()).toBeVisible({ timeout: 20_000 })

    // 新密码能登录
    // ⚠️ 先清掉本地凭据 —— 还处于登录状态时访问 /partner/login 会被守卫弹回订货页
    await page.evaluate(() => localStorage.clear())
    await page.goto('/partner/login')
    await page.getByPlaceholder('请输入登录名').fill(TEMP_LOGIN)
    await page.getByPlaceholder('请输入密码').fill('E2eChanged#2026')
    await page.getByRole('button', { name: /登录/ }).click()
    await page.waitForURL(/\/partner\/shop/, { timeout: 30_000 })
  })

  test('PW-2 普通账号：导航里有"改密码"入口，改密成功', async ({ page }) => {
    await login(page, PARTNER_LOGIN, PARTNER_PASS)
    await page.waitForURL(/\/partner\/shop/, { timeout: 30_000 })

    // 导航入口
    await page.goto('/partner/password')
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible({ timeout: 15_000 })

    // 两次输入不一致 → 提示
    await page.locator('#pw-current').fill(PARTNER_PASS)
    await page.locator('#pw-new').fill('E2eNewPass#2026')
    await page.locator('#pw-confirm').fill('E2eOther#2026')
    await page.getByRole('button', { name: /保存新密码/ }).click()
    await expect(page.getByText(/不一致/)).toBeVisible({ timeout: 10_000 })

    // 正确改密
    await page.locator('#pw-confirm').fill('E2eNewPass#2026')
    await page.getByRole('button', { name: /保存新密码/ }).click()
    await expect(page.getByText('密码已修改').first()).toBeVisible({ timeout: 15_000 })

    // 改密后会话仍然有效（token 已换成新的）
    await page.goto('/partner/orders')
    await expect(page.getByRole('heading', { name: '我的订单' }).first()).toBeVisible({ timeout: 20_000 })
  })
})
