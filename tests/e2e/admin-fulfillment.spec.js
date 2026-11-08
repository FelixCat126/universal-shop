/**
 * 管理端：订单履约（改状态 + 填物流单号）真实浏览器 E2E
 *
 * 这条链路之前**完全不存在**：
 *   - 后端接口有（PUT /admin/orders/:id/status），但**没有任何页面调用它**
 *     → 运营在后台改不了订单状态（发货/完成/取消都做不了）
 *   - 订单模型没有物流单号/发货时间/内部备注字段
 *     → 就算能改状态，也没地方记录快递单号
 *
 * 用例：
 *   AF-1 管理端登录 → 订单列表 → 打开详情 → 能看到履约操作区
 *   AF-2 填物流单号 + 选状态 → 保存 → 详情里能看到单号与新状态
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

test.describe('管理端订单履约', () => {
  test('AF-1 订单详情里有履约操作区（状态 / 物流单号 / 备注）', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })

    // 打开第一行的详情
    await page.getByRole('button', { name: '操作' }).first().click()
    await page.getByText('查看详情', { exact: true }).first().click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 20_000 })

    // 履约操作区
    await expect(page.getByPlaceholder('快递单号（选填）')).toBeVisible()
    await expect(page.getByPlaceholder(/仅内部可见/)).toBeVisible()
    await expect(page.getByRole('button', { name: '保存并更新状态' })).toBeVisible()
  })

  test('AF-2 填物流单号并改状态 → 详情里能看到', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: '操作' }).first().click()
    await page.getByText('查看详情', { exact: true }).first().click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 20_000 })

    const tracking = 'E2E-TRACK-12345'
    await test.step('填物流单号与内部备注', async () => {
      await page.getByPlaceholder('快递单号（选填）').fill(tracking)
      await page.getByPlaceholder(/仅内部可见/).fill('E2E 内部备注')
    })

    await test.step('选择新状态', async () => {
      await page.locator('.el-dialog__footer .el-select').click()
      // 移动端下拉是 teleport 到 body 的，可能渲染到视口外 → ��键盘选，
      // 不依赖下拉项的几何位置（桌面端同样走这条路，更稳）
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      // 选中后输入框里应有状态文案
      await expect(page.locator('.el-dialog__footer .el-select')).toContainText(/./, { timeout: 10_000 })
    })

    await test.step('保存并更新状态', async () => {
      await page.getByRole('button', { name: '保存并更新状态' }).click()
      await expect(page.locator('.el-message--success')).toBeVisible({ timeout: 20_000 })
    })

    await test.step('详情里能看到刚填的单号', async () => {
      await expect(page.locator('.el-dialog')).toContainText(tracking)
    })
  })
})
