/**
 * 合作方门户：订单列表按状态筛选
 *
 * 合作方界面只对 pending_payment 的单显示"确认支付"按钮，
 * 订单一多就要翻页去找 —— 加了状态筛选后一眼就能筛出来。
 *
 *   PS-1 选状态 → 筛选 → 只剩该状态的订单
 *   PS-2 切回"全部状态" → 订单恢复
 */
import { test, expect } from '@playwright/test'

test.describe('合作方订单按状态筛选', () => {
  test('PS-1 选状态 → 只剩该状态的订单', async ({ page }) => {
    await page.goto('/partner/login')
    await page.getByPlaceholder(/登录名|Login/).first().fill('e2e_partner')
    await page.getByPlaceholder(/密码|Password/).first().fill('E2ePartner#2026')
    await page.getByRole('button', { name: /登录/ }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })

    await page.goto('/partner/orders')
    await expect(page.getByRole('heading', { name: /我的订单|My Orders/ }).first())
      .toBeVisible({ timeout: 20_000 })

    // 筛"待支付"
    // ⚠️ 页面上第一个 <select> 是**语言**下拉，别选错 —— 用 aria-label 精确定位
    const statusSelect = page.getByLabel(/按状态筛选|Filter by status/)
    await statusSelect.selectOption('pending_payment')
    await page.getByRole('button', { name: /筛选|Filter/ }).click()
    await page.waitForTimeout(1500)

    /**
     * 断言要**限定在订单列表里** ——
     * 状态下拉框的 <option> 里也有这些状态文字，算上整页会误判。
     */
    const list = page.locator('li.rounded-xl.bg-white.border').first()
    const statuses = await list.locator('span.rounded-full').allTextContents()
    for (const st of statuses) {
      expect(st.trim(), `筛选后不该出现状态：${st}`).toBe('待支付')
    }

    // 切回"全部状态"
    await statusSelect.selectOption('')
    await page.getByRole('button', { name: /筛选|Filter/ }).click()
    await page.waitForTimeout(1500)
  })
})
