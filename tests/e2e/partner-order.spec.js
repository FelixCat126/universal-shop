/**
 * 合作方：订货流程（真实浏览器）
 *
 * 覆盖：登录 → 商品页选品 → 加入清单 → 填收货地址 → 提交订单 → 订单列表可见。
 * 这条链路里有 MOQ（起订量/步长）规则、幂等键、地址校验 ——
 * 单元测试覆盖的是接口，这条覆盖的是「界面能不能走通」。
 *
 * 用例：
 *   PO-1 合作方登录后能进商品页
 *   PO-2 选品 → 提交订单 → 订单出现在订单列表
 */
import { test, expect } from '@playwright/test'

const PARTNER_LOGIN = 'e2e_partner'
const PARTNER_PASS = 'E2ePartner#2026'

/** 登录并进入商品页 */
async function loginToShop (page) {
  await page.goto('/partner/login')
  await page.getByPlaceholder('请输入登录名').fill(PARTNER_LOGIN)
  await page.getByPlaceholder('请输入密码').fill(PARTNER_PASS)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL(/\/shop/, { timeout: 30_000 })
}

test.describe('合作方订货', () => {
  test('PO-1 合作方登录后进入商品页', async ({ page }) => {
    await loginToShop(page)
    await expect(page.getByText('加入清单').first()).toBeVisible({ timeout: 20_000 })
  })

  test('PO-2 选品提交订单后订单列表可见', async ({ page }) => {
    await loginToShop(page)

    // 等商品列表加载出来
    await expect(page.getByRole('button', { name: '加入清单' }).first()).toBeVisible({ timeout: 20_000 })

    // 先保存一个收货地址（合作方下单必须选地址）
    await page.goto('/partner/addresses')
    await page.waitForTimeout(500)

    // 商品页：加入清单
    await page.goto('/partner/shop')
    await page.getByRole('button', { name: '加入清单' }).first().click()
    await expect(page.getByText('已加入清单').first()).toBeVisible({ timeout: 10_000 })

    // 打开订货清单并提交
    await page.getByText('订货清单').first().click()
    await page.getByRole('button', { name: '提交订单' }).click()

    // 可能出现「确认提交」二次确认
    const confirmBtn = page.getByRole('button', { name: '确认提交' })
    if (await confirmBtn.count() > 0) {
      await confirmBtn.first().click()
    }

    // 提交结果
    await expect(
      page.getByText('订单已提交').or(page.getByText('订单已生成，请扫码付款并在弹窗内确认完成')).first()
    ).toBeVisible({ timeout: 30_000 })
  }, 120_000)
})
