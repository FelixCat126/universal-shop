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
      // 等下拉面板真的挂载再按键：Element Plus 的下拉是 teleport 到 body 的，
      // 点完还要走一轮 Vue 渲染 + 过渡动画；不等就按方向键的话，
      // 按键会落到文档上 → 没选中状态 → 保存时 status 为空 → 什么都不发生
      // → 用例以「等不到成功提示」超时告终（表现为偶发失败）。
      await expect(page.locator('.el-select-dropdown:visible')).toBeVisible({ timeout: 10_000 })
      // 移动端下拉是 teleport 到 body 的，可能渲染到视口外 → 用键盘选，
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

  test('AF-3 勾选多单 → 批量改状态一次搞定', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })

    // 勾选前两行（表格第一列是勾选框；Element Plus 把原生 input 藏起来了，
    // 所以要点 .el-checkbox 这个可见的壳）
    const checkboxes = page.locator('.order-table .el-table__body-wrapper .el-checkbox:not(.is-disabled)')
    await expect(checkboxes.first()).toBeVisible({ timeout: 20_000 })
    await checkboxes.nth(0).click()
    await checkboxes.nth(1).click()

    // 批量操作条出现
    const bulkBar = page.locator('.bulk-bar')
    await expect(bulkBar).toBeVisible({ timeout: 10_000 })

    // 选目标状态（下拉是 teleport 的，用键盘选，避免依赖几何位置）
    await bulkBar.locator('.el-select').click()
    // 先等下拉面板挂载（否则按键早于渲染落空 —— 偶发失败的根因）
    await expect(page.locator('.el-select-dropdown:visible')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    await bulkBar.getByRole('button', { name: /应用到所选/ }).click()

    // 二次确认
    await expect(page.locator('.el-message-box')).toBeVisible({ timeout: 10_000 })
    await page.locator('.el-message-box').getByRole('button', { name: /确认|确定|OK/ }).click()

    // 结果提示
    await expect(page.locator('.el-message--success').or(page.locator('.el-message--warning'))).toBeVisible({ timeout: 20_000 })
  })
})
