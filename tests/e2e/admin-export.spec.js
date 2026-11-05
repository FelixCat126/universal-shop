/**
 * 管理端：异步导出任务（真实浏览器）
 *
 * 覆盖这条链路：登录 → 订单页 → 提交导出任务 → 轮询直到完成 → 下载文件。
 * 这条链路横跨「前端对话框 + 轮询 + 后台 worker + 文件生成」，
 * 单元测试覆盖不到（单元测试是一次性请求，没有轮询与浏览器下载）。
 *
 * 用例：
 *   AE-1 管理端登录后能进订单页
 *   AE-2 提交订单导出 → 任务变「已完成」→ 能下载到 xlsx
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = 'e2e_admin'
const ADMIN_PASS = 'E2eAdmin#2026'

test.describe('管理端异步导出', () => {
  test('AE-1 管理员登录后进入订单页', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByPlaceholder('请输入管理员用户名').fill(ADMIN_USER)
    await page.getByPlaceholder('请输入密码').fill(ADMIN_PASS)
    await page.getByRole('button', { name: '登录' }).click()

    // 登录成功后应跳离登录页
    await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 })
  })

  test('AE-2 提交订单导出并下载完成的文件', async ({ page }) => {
    // 登录
    await page.goto('/admin/login')
    await page.getByPlaceholder('请输入管理员用户名').fill(ADMIN_USER)
    await page.getByPlaceholder('请输入密码').fill(ADMIN_PASS)
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 })

    // 订单页 → 打开导出任务对话框
    await page.goto('/admin/orders')
    await page.getByRole('button', { name: /导出/ }).first().click()
    await expect(page.getByText('导出任务')).toBeVisible({ timeout: 15_000 })

    // 选「订单数据」并提交
    await page.getByRole('button', { name: '提交导出' }).click()

    // 轮询直到任务状态变成「已完成」（对话框每 3s 刷新一次）
    // 注意要限定在对话框内：订单页的统计卡片里也有一个「已完成」
    const dialog = page.locator('.el-dialog')
    await expect(dialog.getByText('已完成')).toBeVisible({ timeout: 60_000 })

    // 下载
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: '下载' }).first().click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
  }, 120_000)
})
