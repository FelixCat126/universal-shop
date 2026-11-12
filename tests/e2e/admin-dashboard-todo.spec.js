/**
 * 管理端面板：今日待办卡片 + 深链跳转
 *
 * 面板上的待办数是商家每天真正要盯的东西（要发几单、没付几单、几个商品要补货）。
 * 但只有数字没用 —— 必须能**点进去直接看到那些单**，而且列表条数要和卡上数字对得上。
 *
 *   DB-1 面板显示"今日待办"分组和六个待办卡
 *   DB-2 点"待发货" → 订单页已按 paid+shipping 筛选（多选框里有两个状态）
 *   DB-3 点"低库存" → 商品页已按"低库存"筛选
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

test.describe('管理端面板：今日待办', () => {
  test('DB-1 面板显示今日待办分组和六个待办卡', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/dashboard')

    await expect(page.getByRole('heading', { name: '今日待办' })).toBeVisible({ timeout: 20_000 })

    // 六个待办卡（今日订单/今日营收/待发货/待支付/低库存/缺货）
    for (const label of ['今日订单数', '今日营收', '待发货', '待支付', '低库存', '缺货']) {
      await expect(
        page.locator('.stats-card').filter({ hasText: label }).first(),
        `面板缺少待办卡：${label}`
      ).toBeVisible({ timeout: 10_000 })
    }
  })

  test('DB-2 点"待发货" → 订单页已按多状态筛选', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/dashboard')

    const card = page.locator('.stats-card').filter({ hasText: '待发货' }).first()
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.click()

    // 落到订单页，且 URL 里带着两个状态
    await expect(page).toHaveURL(/\/admin\/orders/, { timeout: 20_000 })
    await expect(page).toHaveURL(/status=paid%2Cshipping|status=paid,shipping/, { timeout: 10_000 })

    // 多选框里应已选中"已支付"和"送货中"两个状态
    const select = page.locator('.search-form .el-select').first()
    await expect(select).toContainText('已支付', { timeout: 15_000 })
    await expect(select).toContainText('送货中', { timeout: 15_000 })
  })

  test('DB-3 点"低库存" → 商品页已按低库存筛选', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/dashboard')

    const card = page.locator('.stats-card').filter({ hasText: '低库存' }).first()
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.click()

    await expect(page).toHaveURL(/\/admin\/products/, { timeout: 20_000 })
    await expect(page).toHaveURL(/stockStatus=low/, { timeout: 10_000 })

    // 库存筛选下拉应已选中"库存不足"（= 后端的 stockStatus=low）
    // ⚠️ 商品页第一个下拉是**分类**，库存状态是第二个 —— 按表单项文字定位，别按序号猜
    const stockSelect = page.locator('.search-form .el-form-item')
      .filter({ hasText: '库存状态' })
      .locator('.el-select')
    await expect(stockSelect).toContainText('库存不足', { timeout: 15_000 })
  })
})
