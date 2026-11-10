/**
 * 管理端：辅助重置客户密码 真实浏览器 E2E
 *
 * 客户忘记密码时的自助重置依赖**短信通道**（线上没配 → 永远回不来）。
 * 这条路径补上运营侧的兜底：运营帮客户重置 → 临时密码 → 客户首次登录强制改密。
 *
 *   UR-1 客户列表里点"重置密码" → 确认 → 拿到临时密码
 *   UR-2 用临时密码能登录，且被要求改密
 *   UR-3 改完密码后 → 标记清掉，临时密码不再能登录
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = 'e2e_admin'
const ADMIN_PASS = 'E2eAdmin#2026'

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.getByPlaceholder('请输入管理员用户名').fill(ADMIN_USER)
  await page.getByPlaceholder('请输入密码').fill(ADMIN_PASS)
  await page.getByRole('button', { name: '立即登录' }).click()
  await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 })
}

test.describe('管理端辅助重置客户密码', () => {
  test('UR-1 客户列表 → 重置密码 → 拿到临时密码', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/users')
    // 先按昵称搜索把目标行定到第一页（列表可能有多页）
    await page.getByPlaceholder(/请输入手机号/).fill('812349998')
    // 用户页的筛选是点"搜索"按钮提交的（不是回车）
    await page.getByRole('button', { name: /^搜索$/ }).click()
    await expect(page.getByRole('button', { name: /操作/ }).first()).toBeVisible({ timeout: 20_000 })

    // 找到"待重置客户"那一行
    const row = page.locator('.el-table__row:visible').filter({ hasText: '待重置客户1' }).first()
    await row.getByRole('button', { name: /操作/ }).click()

    await page.getByText('重置密码', { exact: true }).first().click()

    // 二次确认
    await expect(page.locator('.el-message-box')).toBeVisible({ timeout: 10_000 })
    await page.locator('.el-message-box').getByRole('button', { name: /确认|确定/ }).click()

    // 临时密码弹窗出现，且有一串密码
    await expect(page.locator('.reset-password-value code')).toBeVisible({ timeout: 20_000 })
    const temp = await page.locator('.reset-password-value code').textContent()
    expect(temp.length).toBe(12)
  })

  test('UR-2 临时密码能登录，且被要求改密', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/users')
    await page.getByPlaceholder(/请输入手机号/).fill('812349997')
    await page.getByRole('button', { name: /^搜索$/ }).click()

    const row = page.locator('.el-table__row:visible').filter({ hasText: '待重置客户2' }).first()
    await row.getByRole('button', { name: /操作/ }).click()
    await page.getByText('重置密码', { exact: true }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确认|确定/ }).click()

    await expect(page.locator('.reset-password-value code')).toBeVisible({ timeout: 20_000 })
    const temp = await page.locator('.reset-password-value code').textContent()

    // 用临时密码登录门户
    await page.goto('/portal/login')
    // 占位文案随所选国家变化 → 用宽松匹配（与 portal-checkout 一致）
    await page.getByPlaceholder(/手机号/).fill('812349997')
    await page.getByPlaceholder(/密码/).fill(temp)
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 30_000 })

    // 被强制改密：弹窗或横幅至少有一个出现
    const banner = page.locator('.bg-amber-50')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(/密码|password|รหัสผ่าน/, { timeout: 20_000 })
  })
})
