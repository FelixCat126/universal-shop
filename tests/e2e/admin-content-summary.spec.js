/**
 * 内容完整度汇总条（第 62 轮）
 * =============================
 *
 * ## 从"每行两个标签"到"顶部一行汇总 + 点数字直接筛"
 *
 * 生产上 18 个商品**全部**缺泰文名、16 个缺描述 → 每行都挂标签，
 * 标签就成了噪音。改成：
 *
 *   - 表格上方一条汇总：共 N 个商品 · 缺泰文名 X · 缺描述 Y
 *   - 点那个数字 → 列表只剩要补的
 *   - 每行不再挂标签
 *
 * ## 用例
 *
 *   CS-A 汇总条显示真实数量
 *   CS-B 点汇总条上的数字 → 列表只剩缺内容的那些
 *   CS-C 每行**不再**有「缺泰文名/缺描述」灰标签（噪音没了）
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

test.describe('内容完整度汇总条', () => {
  test('CS-A/CS-B/CS-C 汇总条显示数量、点数字直接筛、每行不再挂标签', async ({ page }) => {
    await loginAdmin(page)

    // 先造一个**缺泰文名**的商品（name_th 不给 → null）
    const cats = await page.request.get('/api/product-categories')
    const cat = ((await cats.json())?.data || [])[0]
    expect(cat, '基线里应有分类').toBeTruthy()

    const adminLogin = await page.request.post('/api/admin/login', { data: ADMIN_USER })
    const adminToken = (await adminLogin.json()).data.token
    const created = await page.request.post('/api/products', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'CS-缺泰文名的商品',
        category_id: cat.id,
        price: 88,
        stock: 5,
        status: 'active'
      }
    })
    expect(created.status(), `造商品失败：${created.status()}`).toBe(201)
    const productName = (await created.json()).data.name

    await page.goto('/admin/products')
    const bar = page.locator('.content-summary-bar')
    await expect(bar, '表格上方应有内容完整度汇总条').toBeVisible({ timeout: 20_000 })

    // 汇总条上要有"缺泰文名"这个可点的数字
    const chip = bar.locator('.content-chip').filter({ hasText: '缺泰文名' })
    await expect(chip, '汇总条上应有「缺泰文名」的可点项').toBeVisible({ timeout: 10_000 })
    const countText = (await chip.locator('.content-chip__count').innerText()).trim()
    expect(Number(countText), '汇总数字应是数字').toBeGreaterThanOrEqual(1)

    // CS-C：每行**不再**挂「缺泰文名/缺描述」灰标签
    const rowTags = page.locator('.el-table__body-wrapper .el-table__row .el-tag')
      .filter({ hasText: /缺泰文名|缺描述|Missing Thai|Missing description/i })
    await expect(rowTags, '每行不该再挂内容完整度标签（生产上每行都缺 → 变成噪音）').toHaveCount(0)

    // CS-B：点一下 → 列表只剩缺泰文名的商品
    await chip.click()
    await page.waitForTimeout(1500)
    const rows = page.locator('.el-table__body-wrapper .el-table__row')
    await expect(rows.first(), '筛选后应至少有一行').toBeVisible({ timeout: 15_000 })
    const rowTexts = await rows.allInnerTexts()
    expect(rowTexts.length, '筛选后应只剩缺泰文名的那些').toBeGreaterThan(0)
    expect(rowTexts.join(' ')).toContain(productName)
    await expect(chip, '被选中的筛选项要有选中态').toHaveClass(/is-active/)

    // 再点一次 → 取消筛选
    await chip.click()
    await page.waitForTimeout(1500)
    await expect(chip).not.toHaveClass(/is-active/)
  })
})
