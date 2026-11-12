/**
 * 门户：商品详情页点「相关推荐」必须换内容
 *
 * Vue Router 4 在**同一条路由记录、只是 param 不同**时会复用组件实例，
 * onMounted 不再触发 —— 页面地址栏变了、内容还是旧商品。
 *
 * 真实后果：点「相关推荐」里的另一个商品 → 页面还显示原来那个
 * （图/价/库存全是旧的）→ 用户点「加入购物车」加进去的是**错的商品**。
 *
 *   PD-1 点相关推荐 → URL 变了且页面显示的是新商品
 */
import { test, expect, request } from '@playwright/test'

test.describe('门户商品详情页切换', () => {
  test('PD-1 点「相关推荐」→ 页面换成新商品', async ({ page }) => {
    // 用公开 API 拿两个商品的 id（详情页的"相关推荐"是同分类的其它在售商品）
    const api = await request.newContext({ baseURL: 'http://127.0.0.1:3000' })
    const res = await api.get('/api/products?page=1&pageSize=50')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    const products = body?.data?.products || []
    const main = products.find(p => p.name === 'E2E 测试商品')
    const related = products.find(p => p.name === 'E2E 推荐商品')
    expect(main, 'E2E 测试商品应存在').toBeTruthy()
    expect(related, 'E2E 推荐商品应存在').toBeTruthy()
    await api.dispose()

    await page.goto(`/portal/products/${main.id}`)
    await expect(page.getByText('E2E 测试商品').first()).toBeVisible({ timeout: 20_000 })

    // 底部的「相关推荐」里应有同分类的另一个商品
    const relatedLink = page.locator('a[href*="/portal/products/"]').filter({ hasText: 'E2E 推荐商品' }).first()
    await expect(relatedLink, '相关推荐里应有另一个商品').toBeVisible({ timeout: 20_000 })

    await relatedLink.click()

    // URL 必须变成新商品
    await page.waitForURL(new RegExp(`/portal/products/${related.id}`), { timeout: 20_000 })

    // ⚠️ 关键：**主标题**必须换成新商品（地址栏变了但内容没变 = bug 复现）
    // 断言主标题而不是"页面上没有旧名字"—— 两个商品互为相关推荐，
    // 切换后旧名字仍会出现在"相关推荐"区里。
    const title = page.locator('h1').filter({ hasText: 'E2E' }).first()
    await expect(title).toHaveText('E2E 推荐商品', { timeout: 15_000 })
  })
})
