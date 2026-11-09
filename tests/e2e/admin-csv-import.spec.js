/**
 * 管理端：CSV 批量导入商品 真实浏览器 E2E
 *
 * 这条链路之前**完全不存在**：运营录商品只能一个一个填表单，
 * 改 20 个商品的价格要点 20 次 —— 漏掉一个就是亏本。
 *
 * 用例：
 *   CI-1 打开导入对话框 → 选 CSV → 预览 → 看到"可导入/有问题"的统计
 *   CI-2 有问题的行 → 逐行列出原因，且**不允许**导入（按钮禁用）
 *   CI-3 全部合法的 CSV → 确认导入 → 新商品出现在列表里
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

/** 在文件选择框里塞一个 CSV（内存文件，不落盘） */
/**
 * ⚠️ 必须限定在**可见的对话框**里：页面上不止一个 file input
 * （管理端还有其它上传入口），`.first()` 可能选中别的那个 ——
 * 于是本该上传的文件没进去，导进去的是**上一次残留的内容**。
 */
async function attachCsv (page, content) {
  await page.locator('.el-dialog:visible input[type="file"]').setInputFiles({
    name: 'products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('﻿' + content, 'utf8')
  })
}

/**
 * 导入出来的商品要**清理掉**。
 *
 * 所有 E2E spec 共用同一个测试库/同一个测试商品：
 * 导入的商品会留在列表里 → 游客下单那条用例的"立即购买"就变成 2 个
 * （详情页会展示相关推荐，每个推荐也带一个"立即购买"按钮）
 * → strict mode violation → 别人家的用例因为我的数据而红。
 *
 * 这不是"可接受的干扰"，是测试没做好：自己造的数据自己负责清。
 */
async function deleteImportedProduct (page, name) {
  await page.goto('/admin/products')
  const search = page.getByPlaceholder('搜索产品名称').first()
  await search.fill(name)
  await page.keyboard.press('Enter')

  const row = page.locator('.el-table__row:visible').filter({ hasText: name }).first()
  await row.getByRole('button', { name: /操作/ }).click()
  // 商品的"删除"在 UI 上叫「下架」（软删：从公开列表里隐藏，数据还在）
  await page.getByText('下架', { exact: true }).first().click()
  // 二次确认
  await page.locator('.el-message-box').getByRole('button', { name: /确认|确定/ }).click()
  await expect(page.locator('.el-message--success')).toBeVisible({ timeout: 20_000 })
}

test.describe('管理端 CSV 批量导入', () => {
  test('CI-1 选文件 → 预览 → 看到统计', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/products')
    await expect(page.getByRole('button', { name: /导入 CSV/ })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: /导入 CSV/ }).click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 10_000 })

    await attachCsv(page, [
      'id,name,price,stock,category',
      ',E2E导入商品A,88,5,食品',
      ',E2E导入商品B,99,6,食品'
    ].join('\n'))

    await page.getByRole('button', { name: /^预览$/ }).click()

    // 预览摘要出现
    await expect(page.locator('.csv-summary')).toContainText(/2/, { timeout: 20_000 })
    await expect(page.locator('.csv-summary')).toContainText(/可导入/, { timeout: 10_000 })
  })

  test('CI-2 有问题的行 → 逐行列出原因，且不能导入', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/products')
    await page.getByRole('button', { name: /导入 CSV/ }).click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 10_000 })

    await attachCsv(page, [
      'id,name,price,stock,category',
      ',好商品,10,5,食品',
      ',坏商品,abc,5,食品'
    ].join('\n'))

    await page.getByRole('button', { name: /^预览$/ }).click()

    // 有问题的行被列出来，且带原因
    await expect(page.locator('.csv-error')).toContainText(/价格/, { timeout: 20_000 })
    // 导入按钮必须禁用 —— 有问题时不允许落库
    const importBtn = page.getByRole('button', { name: /确认导入/ })
    await expect(importBtn).toBeDisabled()
  })

  test('CI-3 全部合法 → 确认导入 → 列表里出现新商品', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/products')
    await page.getByRole('button', { name: /导入 CSV/ }).click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 10_000 })

    const name = 'E2E导入商品C' + Date.now()
    await attachCsv(page, [
      'id,name,price,stock,category',
      `,${name},123,7,食品`
    ].join('\n'))

    await page.getByRole('button', { name: /^预览$/ }).click()
    await expect(page.locator('.csv-summary')).toContainText(/可导入/, { timeout: 20_000 })

    await page.getByRole('button', { name: /确认导入/ }).click()
    // 用"对话框关闭"作为成功信号（预览那步的 success toast 还没消失，会骗过断言）
    await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 30_000 })

    // 导入后列表里能找到
    // ⚠️ 必须用 `.el-table__row:visible` —— Element Plus 的固定列会渲染**隐藏的副本表**，
    // getByText 会命中隐藏副本里的那个（"expected visible, received hidden"，但数据其实是对的）
    await page.getByPlaceholder('搜索产品名称').first().fill(name)
    await page.keyboard.press('Enter')
    const row = page.locator('.el-table__row:visible').filter({ hasText: name }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })

    // 清理：自己造的数据自己清（见文件头的说明）
    await deleteImportedProduct(page, name)
  })
})
