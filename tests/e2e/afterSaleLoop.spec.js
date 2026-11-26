/**
 * 售后闭环（真实浏览器，第 45 轮）
 * ================================
 *
 * ## 为什么要有这条
 *
 * 售后的**后端接口一直都在**，但三端都没有界面入口：
 * 客户不能发起、管理端看不到、审核结果客户也看不到 ——
 * 用户提交的售后单在系统里 pending 悬空，谁也处理不了。
 *
 * 这条用**真实浏览器**走完整一圈（光有接口测试不够 —— 界面入口才是这次要补的东西）：
 *
 *   客户下单 → 订单详情页「申请售后」→ 个人中心「我的售后」能看到 →
 *   管理端「售后管理」页面能看到并审核 → 客户看到处理结果
 *
 * ## 用例
 *   AS-E1 客户在订单详情页发起售后，个人中心能看到（待处理）
 *   AS-E2 管理端售后页能看到这条申请，并审核通过
 *   AS-E3 审核后客户侧看到"已同意"与处理说明
 */
import { test, expect } from '@playwright/test'
import { acceptConsent } from './helpers/consent.js'

const USER_PHONE = '812345678'
const USER_PASS = 'Portal#2026'

async function loginCustomer (page) {
  await page.goto('/portal/login')
  await page.getByPlaceholder(/手机号/).fill(USER_PHONE)
  await page.getByPlaceholder(/密码/).fill(USER_PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 30_000 })
}

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.waitForLoadState('domcontentloaded')
  await page.getByPlaceholder(/用户名|账号|username/i).fill('e2e_admin')
  await page.getByPlaceholder(/密码|password/i).fill('E2eAdmin#2026')
  await page.getByRole('button', { name: /登录|登 录|立即登录/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

/** 下一单并拿到订单详情页 URL */
async function placeOrder (page) {
  await page.goto('/portal/')
  await expect(page.getByText('E2E 测试商品').first()).toBeVisible({ timeout: 20_000 })
  await page.getByText('E2E 测试商品').first().click()
  await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 20_000 })
  await page.getByTestId('product-buy-now').click()
  await expect(page).toHaveURL(/\/checkout/, { timeout: 20_000 })
  const addressCard = page.getByText('E2E 登录用户').first()
  await expect(addressCard).toBeVisible({ timeout: 20_000 })
  await addressCard.click()
  // 第 54 轮：结算页新增「条款 + 年龄」确认（服务端强制）
  await acceptConsent(page)
  await page.getByRole('button', { name: '提交订单' }).click()
  await page.waitForURL(/\/profile\?tab=orders/, { timeout: 30_000 })
}

test.describe('售后闭环（真实浏览器）', () => {
  test('AS-E1/2/3 申请 → 管理端审核 → 客户看到结果', async ({ page }) => {
    // 客户下单
    await loginCustomer(page)
    await placeOrder(page)

    // 打开第一单的详情
    const firstOrder = page.locator('button, a').filter({ hasText: /查看详情|详情|Detail/i }).first()
    await firstOrder.click()
    await page.waitForURL(/\/orders\/\d+/, { timeout: 20_000 })

    // 发起售后
    const applyBtn = page.getByRole('button', { name: /申请售后|Request after-sales/i })
    await expect(applyBtn, '订单详情页应有「申请售后」入口').toBeVisible({ timeout: 20_000 })
    await applyBtn.click()

    const reasonBox = page.locator('textarea')
    await expect(reasonBox).toBeVisible({ timeout: 10_000 })
    await reasonBox.fill('E2E 售后测试：商品与描述不符')
    await page.getByRole('button', { name: /提交申请|Submit request/i }).click()

    // 提交成功提示
    await expect(page.getByText(/售后申请已提交|After-sales request submitted/i).first())
      .toBeVisible({ timeout: 20_000 })

    // 个人中心「我的售后」能看到
    await page.goto('/portal/profile?tab=afterSales')
    await expect(page.getByText(/售后测试：商品与描述不符/).first())
      .toBeVisible({ timeout: 20_000 })

    // 管理端能看到并审核
    const admin = await page.context().newPage()
    await loginAdmin(admin)
    await admin.goto('/admin/after-sales')
    await expect(admin.getByText('E2E 售后测试：商品与描述不符').first())
      .toBeVisible({ timeout: 20_000 })

    // 审核通过
    await admin.getByRole('button', { name: /同意|Approve/i }).first().click()
    const noteBox = admin.locator('textarea')
    if (await noteBox.count()) {
      await noteBox.first().fill('E2E 已退款')
    }
    await admin.getByRole('button', { name: /^(确认|确定|Confirm|OK)$/ }).last().click()
    await expect(admin.getByText(/已同意|Approved/i).first()).toBeVisible({ timeout: 20_000 })

    // 客户侧看到处理结果
    await page.goto('/portal/profile?tab=afterSales')
    await expect(page.getByText(/E2E 已退款/).first()).toBeVisible({ timeout: 20_000 })
  })
})
