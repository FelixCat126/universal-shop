/**
 * 列表页滚动位置记忆（第 42 轮）
 *
 * ## 用户体感
 *
 * 「在商品列表翻到第 3 屏 → 点进详情 → 点返回」——
 * 修复前回到的是 **scrollY=294**（位置丢了一半），而且列表会莫名变成 **两页商品**。
 *
 * 后者更隐蔽：返回后用户看到"列表怎么多了一倍"，会以为系统出错。
 * 根因是无限滚动被误触发（返回时页面只渲染了第一页，高度不够 → 底部哨兵进入视口）。
 *
 * ## 用例
 *   SM-1 列表 → 详情 → 返回：滚动位置恢复（容差 60px）
 *   SM-2 返回后**商品数量不变**（不会因为误触发无限滚动而翻倍）
 *   SM-3 详情页本身不恢复位置（从列表点进来就该看到顶部）
 */
import { test, expect } from '@playwright/test'

test.describe('列表页滚动位置记忆', () => {
  test('SM-1/2 返回列表：位置恢复且商品数不翻倍', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/portal/')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(800)

    const initialCount = await page.locator('h3').count()
    expect(initialCount, '首页应有商品').toBeGreaterThan(1)

    /**
     * 滚到可滚动高度的 50%（动态计算）：
     * 测试库的商品数量与生产不同，写死 1200px 在内容少时根本滚不到 →
     * 断言会假失败。
     */
    const maxScroll = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
    if (maxScroll < 150) {
      test.skip(true, '内容不足以滚动，跳过')
      return
    }
    const target = Math.round(maxScroll * 0.5)
    await page.evaluate((y) => window.scrollTo(0, y), target)
    await page.waitForTimeout(500)
    const scrolledTo = await page.evaluate(() => Math.round(window.scrollY))
    expect(Math.abs(scrolledTo - target), `应已滚动到约 ${target}px，实际 ${scrolledTo}`).toBeLessThanOrEqual(60)

    /**
     * 点进**当前视口内**的一个商品详情。
     *
     * ⚠️ 不能用 `page.locator('h3').first().click()`：
     *    Playwright 的 click 会先 **scrollIntoView** —— 第一个标题在页面顶部，
     *    于是它把页面滚回顶部 → 离开时 scrollY 已经是 0 → 记住的位置自然是 0，
     *    断言就会误报"没记住"。
     *    这里改成用 evaluate 触发点击（不滚动），并挑一个当前视口内的标题。
     */
    await page.evaluate(() => {
      const titles = [...document.querySelectorAll('h3')]
      const visible = titles.find((h) => {
        const r = h.getBoundingClientRect()
        return r.top > 80 && r.bottom < window.innerHeight
      }) || titles[0]
      const card = visible?.closest('[class*="rounded-xl"], [class*="rounded-lg"]')
      if (card) card.click()
    })
    await page.waitForURL(/\/products\/\d+/, { timeout: 20_000 })
    await page.waitForTimeout(800)
    const detailScroll = await page.evaluate(() => Math.round(window.scrollY))
    expect(detailScroll, '详情页应从顶部开始（不恢复列表位置）').toBeLessThan(60)

    // 点「返回」
    const back = page.getByRole('button', { name: /返回|Back/i }).first()
    await back.click()
    await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 20_000 })
    await page.waitForTimeout(2500)

    const afterScroll = await page.evaluate(() => Math.round(window.scrollY))
    const afterCount = await page.locator('h3').count()

    /**
     * 断言"记住的位置"本身，而不只是"返回后的位置"。
     *
     * 原因：测试库的商品比生产少，页面可能**根本滚不到目标位置**，
     * 这时"恢复成功"与"被截断到底部"的结果完全一样 → 只断言位置会**假绿**。
     * 直接断言存下来的值，才能证明"记忆逻辑确实在跑"。
     * ⚠️ key 用的是路由的 fullPath（首页是 "/"，不含 base 前缀 /portal/）。
     */
    const remembered = await page.evaluate(() =>
      Number(window.sessionStorage.getItem('scroll:/') || 0))
    expect(
      Math.abs(remembered - target),
      `应记住滚动位置 ${target}，实际 ${remembered}`
    ).toBeLessThanOrEqual(60)

    expect(
      Math.abs(afterScroll - scrolledTo),
      `返回后位置应为 ${scrolledTo}，实际 ${afterScroll}`
    ).toBeLessThanOrEqual(60)

    expect(
      afterCount,
      `返回后商品数应不变（${initialCount}），实际 ${afterCount} —— 无限滚动被误触发了两页`
    ).toBe(initialCount)
  })
})
