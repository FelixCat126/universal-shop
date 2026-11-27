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
 * ## 本用例为什么自己造一单
 *
 * Playwright 默认**按文件大小排序**跑用例 —— 本文件会排在
 * `admin-fulfillment` / `journeyAdmin` **之后**，而那些用例已经把订单状态改成
 * 「已发货/已完成」了 → "备货中"的订单可能一个都不剩 → 本用例必挂。
 *
 * 这正是项目里踩过的老坑（"两个 Playwright project 共用一个服务，
 * 改数据的用例必须可重复跑"）。所以这里**自己造一单 COD 订单**
 * （COD 下单直接就是「送货中」），再按**订单号**搜出来 ——
 * 不依赖别的用例跑过什么，也不依赖列表里还剩几单。
 *
 * ## 用例
 *
 *   AF-4 造一单 → 管理端按订单号搜出来 → 选「已发货」→ 出现物流单号区并列出对应关系
 *   AF-5 一个都不填 → 允许提交；填了一部分 → **提交按钮禁用**
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = { username: 'e2e_admin', password: 'E2eAdmin#2026' }
const PORTAL_USER = { phone: '812345678', password: 'Portal#2026' }

async function loginAdmin (page) {
  const res = await page.request.post('/api/admin/login', { data: ADMIN_USER })
  expect(res.status(), '管理员登录失败').toBe(200)
  const token = (await res.json()).data.token
  await page.addInitScript((t) => {
    localStorage.setItem('admin_token', t)
    localStorage.setItem('admin_info', JSON.stringify({ id: 1, username: 'admin', role: 'super_admin' }))
  }, token)
}

/**
 * 自己造一单 COD 订单（COD 下单直接就是「送货中」→ 可改成「已发货」）。
 * @returns {Promise<string>} 订单号
 */
async function createShippingOrder (page) {
  // 登录要带 country_code（种子用户的区号是 +66）
  const login = await page.request.post('/api/users/login', {
    data: { country_code: '+66', ...PORTAL_USER }
  })
  expect(login.status(), '门户用户登录失败').toBe(200)
  const token = (await login.json()).data.token

  const list = await page.request.get('/api/products?page=1&pageSize=20')
  const products = (await list.json())?.data?.products || []
  const product = products.find(p => Number(p.stock) > 0)
  expect(product, '基线里应有可售商品').toBeTruthy()

  const created = await page.request.post('/api/orders', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      items: [{ product_id: product.id, quantity: 1 }],
      contact_name: 'AF 测试',
      contact_phone: '0812345678',
      delivery_address: 'AF 测试地址',
      payment_method: 'cod',
      terms_accepted: true,
      age_confirmed: true
    }
  })
  expect(created.status(), `造单失败：${created.status()}`).toBe(201)
  const body = await created.json()
  return body.data.order.order_no
}

/**
 * 在一个下拉里选一个选项。
 *
 * ⚠️ 不用 `expect(dropdown).toBeHidden()` 判断"下拉已收起"：
 *    Element Plus 的下拉是 teleport 到 body 的，多个下拉会同时留在 DOM 里，
 *    `toBeHidden()` 在这种情况下要么匹配到还开着的那个、要么 strict 冲突 ——
 *    是个纯 flaky 源。改成"点完按 Esc + 等列表刷新"，用**真实信号**判断。
 */
async function pickOption (page, selectLocator, label) {
  await selectLocator.click()
  const dropdown = page.locator('.el-select-dropdown:visible')
  await expect(dropdown).toBeVisible({ timeout: 10_000 })
  await dropdown.getByText(label, { exact: true }).first().click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(900)
}

/** 在管理端按订单号搜出那一单 */
async function searchOrder (page, orderNo) {
  const input = page.getByPlaceholder('订单号/收货人/电话/用户昵称')
  await input.fill(orderNo)
  await input.press('Enter')
  await page.waitForTimeout(1500)
}

test.describe('批量发货：逐单物流单号', () => {
  test('AF-4 按订单号搜出订单 → 选「已发货」→ 出现物流单号区并列出对应关系', async ({ page }) => {
    await loginAdmin(page)
    const orderNo = await createShippingOrder(page)

    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })
    await searchOrder(page, orderNo)

    // 只勾这一单（表格第一列是勾选框；Element Plus 把原生 input 藏起来了）
    const row = page.locator('.order-table .el-table__body-wrapper .el-table__row').filter({ hasText: orderNo }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.locator('.el-checkbox').first().click()

    const bulkBar = page.locator('.bulk-bar')
    await expect(bulkBar).toBeVisible({ timeout: 10_000 })

    // 还没选发货状态 → 不该出现物流单号区（其它状态用不上）
    await expect(page.locator('.bulk-tracking')).toHaveCount(0)

    await pickOption(page, bulkBar.locator('.el-select'), '已发货')
    await expect(page.locator('.bulk-tracking')).toBeVisible({ timeout: 5_000 })

    // 粘贴单号
    await page.locator('.bulk-tracking__input textarea').fill('SF-AF-001')

    // 对应关系要**列出来**（哪一单 ← 哪个单号）
    const preview = page.locator('.bulk-tracking__preview li')
    await expect(preview).toHaveCount(1, { timeout: 5_000 })
    await expect(preview.first()).toContainText(orderNo)
    await expect(preview.first()).toContainText('SF-AF-001')

    // 提示语：数量对得上
    await expect(page.locator('.bulk-tracking__hint')).not.toHaveClass(/is-error/)
  })

  test('AF-5 一个都不填允许提交；填了一部分拦住', async ({ page }) => {
    await loginAdmin(page)
    const orderNo = await createShippingOrder(page)

    await page.goto('/admin/orders')
    await expect(page.getByRole('button', { name: '操作' }).first()).toBeVisible({ timeout: 20_000 })
    await searchOrder(page, orderNo)

    const row = page.locator('.order-table .el-table__body-wrapper .el-table__row').filter({ hasText: orderNo }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.locator('.el-checkbox').first().click()

    const bulkBar = page.locator('.bulk-bar')
    await expect(bulkBar).toBeVisible({ timeout: 10_000 })
    await pickOption(page, bulkBar.locator('.el-select'), '已发货')

    const applyBtn = bulkBar.getByRole('button', { name: /应用到所选/ })

    // 一个都不填 → **允许提交**（货代上门取件才拿到单号是常态，先标已发货、单号后补）
    await expect(applyBtn, '没填单号时应允许提交（货代取件后才给单号）').toBeEnabled()

    // 多填一行（比选中订单数多）→ 拦住（"哪几单有单号"是歧义的）
    await page.locator('.bulk-tracking__input textarea').fill('SF-AF-001\nSF-AF-002')
    await expect(page.locator('.bulk-tracking__hint')).toHaveClass(/is-error/)
    await expect(applyBtn, '数量对不上时不能提交').toBeDisabled()

    // 填回一个 → 可以提交
    await page.locator('.bulk-tracking__input textarea').fill('SF-AF-001')
    await expect(applyBtn).toBeEnabled()
  })
})
