/**
 * 批量发货：逐单填物流单号（第 61 轮）
 * ==========================================
 *
 * ## 用户场景
 *
 * 运营打包完一批货，手上有快递系统导出的一**列**单号，
 * 要一张一张贴到订单里。现在只能一单一单打开弹窗填 —— 5 单就是 5 次进出。
 *
 * 新的批量栏：勾选订单 → 选「已发货」→ 粘贴单号（每行一个）→ 一次提交。
 *
 * ## 为什么要把"对应关系"显式列出来
 *
 * 粘贴的是**一列**单号，靠"第 N 行对应第 N 单"是隐式的 ——
 * 运营一旦顺序错位，**发错包裹**，事后极难查。
 * 所以界面上必须写明"哪一单 ← 哪个单号"，并且数量对不上时**拦住提交**。
 *
 * ## 用例
 *
 *   AF-4 选单 + 选「已发货」→ 出现物流单号区；粘贴后列出对应关系
 *   AF-5 单号数量与选中订单数不符 → **提交按钮禁用**（不能"能提交就行"）
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = { username: 'e2e_admin', password: 'E2eAdmin#2026' }

async function loginAdmin (page) {
  const res = await page.request.post('/api/admin/login', { data: ADMIN_USER })
  expect(res.status(), '管理员登录失败').toBe(200)
  const token = (await res.json()).data.token
  await page.addInitScript((t) => {
    localStorage.setItem('admin_token', t)
    localStorage.setItem('admin_info', JSON.stringify({ id: 1, username: 'admin', role: 'super_admin' }))
  }, token)
}

/** 勾选前 N 行 */
async function selectOrders (page, n) {
  const checkboxes = page.locator('.order-table .el-table__body-wrapper .el-checkbox:not(.is-disabled)')
  await expect(checkboxes.first()).toBeVisible({ timeout: 20_000 })
  for (let i = 0; i < n; i++) {
    await checkboxes.nth(i).click()
  }
}

/** 在批量栏里选目标状态 */
async function pickStatus (page, label) {
  const bulkBar = page.locator('.bulk-bar')
  await bulkBar.locator('.el-select').click()
  await expect(page.locator('.el-select-dropdown:visible')).toBeVisible({ timeout: 10_000 })
  await page.locator('.el-select-dropdown:visible').getByText(label, { exact: true }).first().click()
  await expect(page.locator('.el-select-dropdown:visible')).toBeHidden({ timeout: 5_000 })
}

test.describe('批量发货：逐单物流单号', () => {
  test('AF-4 选单 + 选「已发货」→ 出现物流单号区并列出对应关系', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })

    await selectOrders(page, 2)
    const bulkBar = page.locator('.bulk-bar')
    await expect(bulkBar).toBeVisible({ timeout: 10_000 })

    // 还没选发货状态 → 不该出现物流单号区（其它状态用不上）
    await expect(page.locator('.bulk-tracking')).toHaveCount(0)

    await pickStatus(page, '已发货')
    await expect(page.locator('.bulk-tracking')).toBeVisible({ timeout: 5_000 })

    // 粘贴两个单号
    await page.locator('.bulk-tracking__input textarea').fill('SF-AAA111\nSF-BBB222')

    // 对应关系要**列出来**（哪一单 ← 哪个单号）
    const preview = page.locator('.bulk-tracking__preview li')
    await expect(preview).toHaveCount(2, { timeout: 5_000 })
    await expect(preview.nth(0)).toContainText('SF-AAA111')
    await expect(preview.nth(1)).toContainText('SF-BBB222')

    // 提示语：数量对得上
    await expect(page.locator('.bulk-tracking__hint')).not.toHaveClass(/is-error/)
  })

  test('AF-5 单号数量对不上 → 提交按钮禁用', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })

    await selectOrders(page, 2)
    const bulkBar = page.locator('.bulk-bar')
    await expect(bulkBar).toBeVisible({ timeout: 10_000 })
    await pickStatus(page, '已发货')

    const applyBtn = bulkBar.getByRole('button', { name: /应用到所选/ })
    await expect(applyBtn, '没填单号时不该能提交').toBeDisabled()

    // 只填一个 → 还是不能提交（有一单会没单号）
    await page.locator('.bulk-tracking__input textarea').fill('SF-ONLY-ONE')
    await expect(page.locator('.bulk-tracking__hint')).toHaveClass(/is-error/)
    await expect(applyBtn, '数量对不上时不能提交').toBeDisabled()

    // 填两个 → 可以提交
    await page.locator('.bulk-tracking__input textarea').fill('SF-AAA111\nSF-BBB222')
    await expect(applyBtn).toBeEnabled()
  })
})
