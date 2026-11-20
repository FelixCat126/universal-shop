/**
 * 商城首屏的请求结构（第 43 轮 · 效率低）
 * ==========================================
 *
 * ## 用户体感
 *
 * 首屏慢。以前在浏览器里量到：
 *   4 个 API 请求串行排成一条链：系统配置 → 套餐 → 分类 → 商品
 *   首屏的 API 阶段要 399ms（正好等于 4 个请求耗时之和 = 完全串行）
 *
 * ## 两个根因（都修了）
 *
 * 1. **首页永久锁定第一个分类**
 *    `loadCategories()` 之后会把 `selectedCategoryId` 设成第一个分类，
 *    商品列表因此**必须**带 `category_id` → 必须等分类接口回来才能发商品请求
 *    → 天然串行；而且新分类的商品永远进不了首页首屏。
 *    现在首页默认「全部」，商品请求不再依赖分类结果。
 *
 * 2. **详情页要多跑一个来回**
 *    相关推荐的 `category_id` 只能从详情响应里拿 → 详情与推荐必然串行。
 *    现在 `related` 随详情一起返回。
 *
 * ## 断言为什么这样写
 *
 * - **SF-2 断言"两个请求的时间区间重叠"**，而不是"products 比 categories 早"。
 *   串行时两者区间必然不相交；并行时必然相交。
 *   用"谁先发"来断言会被同毫秒的调度顺序坑到（区间相交不会有这种歧义）。
 *
 * - **SF-3 断言详情页没有再发商品列表请求**（按 URL 里有没有 `?` 区分
 *   `/api/products/12` 与 `/api/products?...`），这样"相关推荐又变回单独请求"会立刻红。
 */
import { test, expect } from '@playwright/test'

/** 资源时间线里的 API 条目（含浮点毫秒，够细） */
async function apiTimeline (page) {
  return page.evaluate(() =>
    performance.getEntriesByType('resource')
      .filter(e => e.name.includes('/api/'))
      .map(e => ({
        url: e.name,
        start: e.startTime,
        end: e.responseEnd
      }))
  )
}

/** 登录管理端并建一个"饮料"分类的商品（首页需要第二个分类的商品才能验证「全部」） */
async function seedSecondCategoryProduct (request) {
  const login = await request.post('/api/admin/login', {
    data: { username: 'e2e_admin', password: 'E2eAdmin#2026' }
  })
  expect(login.status(), '管理端登录失败，无法准备测试数据').toBe(200)
  const token = (await login.json()).data.token

  const cats = await request.get('/api/product-categories')
  expect(cats.status()).toBe(200)
  // 注意：Playwright 的 APIResponse.body 是**方法**，要用 .json()
  const drink = (await cats.json()).data.find(c => c.name === '饮料')
  expect(drink, '基线里应有「饮料」分类').toBeTruthy()

  const created = await request.post('/api/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'E2E 饮料商品',
      description: '用于验证首页展示全部分类商品',
      category_id: drink.id,
      price: 88,
      stock: 100
    }
  })
  expect(created.status(), '创建第二个分类的商品失败').toBe(201)
  return (await created.json()).data
}

/**
 * 软删除刚才造的商品（把首页还原）。
 *
 * E2E 整个 run 共用同一个测试服务（数据只在启动时清一次），
 * 造出来的商品会**留在库里**影响后面的 spec（例如滚动记忆用例要滚到底部）。
 * 所以用完就删（软删除对公开列表不可见，等于还原）。
 */
async function removeSeededProduct (request, productId) {
  const login = await request.post('/api/admin/login', {
    data: { username: 'e2e_admin', password: 'E2eAdmin#2026' }
  })
  const token = (await login.json()).data.token
  await request.delete(`/api/products/${productId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
}

test.describe('商城首屏的请求结构', () => {
  test('SF-1/2 首页默认展示「全部」商品，且分类与商品请求并行', async ({ page, request }) => {
    const seeded = await seedSecondCategoryProduct(request)

    try {
      await page.goto('/portal/')
      await page.waitForLoadState('domcontentloaded')
      // 等商品渲染出来（首页有骨架屏，先等标题出现）
      await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(800)

      /**
       * 分类 Tab 的第一项必须是「全部」，且默认选中。
       *
       * 断言"存在一个选中态的 Tab"不够 —— 修复前第一个分类也是选中态。
       * 要断言的是：**第一个 Tab 就是「全部」**，且它是选中的那个。
       */
      const tabBar = page.locator('div.sticky.z-30')
      await expect(tabBar).toBeVisible()
      const firstTab = tabBar.locator('button').first()
      await expect(firstTab).toBeVisible()
      const firstTabText = (await firstTab.innerText()).trim()
      expect(
        /^(全部|All|ทั้งหมด)$/i.test(firstTabText),
        `分类 Tab 第一项应是「全部」，实际是「${firstTabText}」`
      ).toBe(true)

      // 选中态：蓝底白字的那个类
      const selectedTab = tabBar.locator('button.bg-blue-600')
      await expect(selectedTab).toHaveCount(1)
      expect((await selectedTab.innerText()).trim()).toMatch(/^(全部|All|ทั้งหมด)$/i)

    /**
       * 商品列表要**同时**出现两个分类的商品 ——
       * 修复前首页只显示第一个分类（食品）的商品，饮料商品根本不在首屏。
       */
      const titles = await page.locator('h3').allInnerTexts()
      const allTitles = titles.join(' | ')
      expect(allTitles, '首页应展示第二个分类的商品（修复前只显示第一个分类）')
        .toContain('E2E 饮料商品')
      expect(allTitles, '首页应保留第一个分类的商品').toContain('E2E 测试商品')

      // 商品请求**不带**分类过滤（=「全部」）
      const tl = await apiTimeline(page)
      const listReq = tl.find(r => r.url.includes('/api/products?'))
      expect(listReq, '首页应发出商品列表请求').toBeTruthy()
      expect(listReq.url, '首页默认「全部」→ 商品请求不应带 category_id')
        .not.toContain('category_id')

      /**
       * SF-2：分类请求与商品请求的**时间区间必须相交**（= 并行发出）。
       *
       * 串行时：分类先返回，商品才开始发 → 区间不相交。
       */
      const catReq = tl.find(r => r.url.includes('/api/product-categories'))
      expect(catReq, '首页应发出分类请求').toBeTruthy()
      const overlapped = listReq.start < catReq.end && catReq.start < listReq.end
      expect(
        overlapped,
        `分类与商品请求应并行（区间相交）：分类 [${catReq.start.toFixed(1)}, ${catReq.end.toFixed(1)}]，` +
        `商品 [${listReq.start.toFixed(1)}, ${listReq.end.toFixed(1)}] —— 串行会让首屏多等一个来回`
      ).toBe(true)
    } finally {
      // 还原数据：别让造出来的商品影响后面的 spec
      await removeSeededProduct(request, seeded.id)
    }
  })

  test('SF-3 详情页只发一次商品请求（相关推荐随详情返回）', async ({ page, request }) => {
    // 商品 id 从接口取，不写死（E2E 共用同一个库，id 取决于别的 spec 造了多少数据）
    const list = await request.get('/api/products?page=1&pageSize=1')
    expect(list.status()).toBe(200)
    const productId = (await list.json()).data.products[0].id

    // 直接进详情页，避开首页的无限滚动请求
    await page.goto(`/portal/products/${productId}`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)

    const tl = await apiTimeline(page)
    const detailReqs = tl.filter(r => /\/api\/products\/\d+(\?|$)/.test(r.url))
    const listReqs = tl.filter(r => r.url.includes('/api/products?'))

    expect(detailReqs.length, '详情页应请求一次商品详情').toBe(1)
    expect(
      listReqs.length,
      `详情页不应再单独请求商品列表（相关推荐应随详情返回），实际 ${listReqs.length} 次`
    ).toBe(0)
  })
})
