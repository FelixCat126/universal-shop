/**
 * 手机端固定购买栏（第 64 轮）
 * ============================
 *
 * ## 为什么
 *
 * 手机流量占这个商城的大头，而"加入购物车 / 立即购买"在详情页里排得很靠后
 * （图片 → 名称 → 价格 → 库存 → 描述 → 数量 → 按钮）。
 * 客户要滚过一整屏才够得着按钮 —— 而描述正是运营接下来要补的内容
 * （现在 18 个商品有 17 个没描述），描述越长按钮越靠下。
 *
 * 固定栏保证：**无论内容多长，购买按钮永远在拇指下**。
 *
 * ## 用例
 *
 *   MB-1 手机宽度下有固定购买栏，且**不需要滚动**就能看到
 *   MB-2 固定栏贴底、不遮挡内容（页面底部留了空间）
 *   MB-3 桌面宽度下**没有**固定栏（两栏布局不需要，页内按钮照旧）
 *   MB-4 固定栏里的「加入购物车」真的能打到加购接口
 */
import { test, expect } from '@playwright/test'

const MOBILE = { width: 393, height: 851 }
const DESKTOP = { width: 1280, height: 800 }
const ADMIN_USER = { username: 'e2e_admin', password: 'E2eAdmin#2026' }

/** 拿一个真实商品的 id */
async function firstProductId (page) {
  const res = await page.request.get('/api/products?page=1&pageSize=1')
  const body = await res.json()
  const id = body?.data?.products?.[0]?.id
  expect(id, '基线里应有可售商品').toBeTruthy()
  return id
}

/**
 * 关掉 Cookie 告知横幅。
 *
 * 必须先关掉：横幅也是 fixed bottom，会**盖住**固定购买栏
 * （两个都固定在底部 → 客户点不到「加入购物车」）。
 * 这是真实存在的行为，所以购买栏在横幅显示时是**让位**的。
 */
async function dismissCookieBanner (page) {
  const btn = page.getByRole('button', { name: /我知道了|Got it|รับทราบ/i })
  if (await btn.first().isVisible().catch(() => false)) {
    await btn.first().click()
    await page.waitForTimeout(600)
  }
}

/** 详情页里"固定在视口底部"的**购买栏**（必须含购买按钮，CookieBanner 不算） */
async function bottomBar (page) {
  return page.evaluate(() => {
    const vh = window.innerHeight
    const el = [...document.querySelectorAll('div')].filter(e => {
      const cs = getComputedStyle(e)
      if (cs.position !== 'fixed') return false
      const r = e.getBoundingClientRect()
      if (!(r.bottom >= vh - 2 && r.height > 40 && r.height < vh * 0.4)) return false
      return !!e.querySelector('[data-testid="product-buy-now-bar"]')
    })[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      height: Math.round(r.height),
      bottom: Math.round(r.bottom),
      viewportH: vh,
      hasAddToCart: !!el.querySelector('[data-testid="product-add-to-cart-bar"]'),
      hasBuyNow: !!el.querySelector('[data-testid="product-buy-now-bar"]')
    }
  })
}

test.describe('手机端固定购买栏', () => {
  test('MB-1 手机宽度下有固定购买栏，且不滚动就能看到', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto(`/portal/products/${await firstProductId(page)}`)
    await page.waitForSelector('[data-testid="product-detail-content"]')
    await page.waitForTimeout(1200)

    /**
     * 先看**横幅还在**的时候：购买栏必须**让位**（不显示）。
     *
     * 两个都固定在底部 → 横幅会把购买栏盖住，客户点不到「加入购物车」。
     * 所以横幅在时购买栏隐藏，关掉横幅它才出现。
     */
    const beforeAccept = await bottomBar(page)
    expect(beforeAccept, 'Cookie 横幅显示时，购买栏必须让位（否则被盖住点不到）').toBeFalsy()

    await dismissCookieBanner(page)

    const bar = await bottomBar(page)
    expect(bar, '手机端详情页应有固定购买栏').toBeTruthy()
    expect(bar.hasAddToCart, '固定栏里应有「加入购物车」').toBe(true)
    expect(bar.hasBuyNow, '固定栏里应有「立即购买」').toBe(true)

    // 关键：**不用滚动**就可见（页面刚打开时就在视口内）
    const buyNow = page.getByTestId('product-buy-now-bar').filter({ visible: true })
    await expect(buyNow).toBeVisible({ timeout: 10_000 })
    const inViewport = await buyNow.evaluate(el => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight + 2
    })
    expect(inViewport, '固定栏里的按钮应该在视口内（不用滚动就能点到）').toBe(true)
  })

  test('MB-2 固定栏不遮挡页面内容（页面底部留了空间）', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto(`/portal/products/${await firstProductId(page)}`)
    await page.waitForSelector('[data-testid="product-detail-content"]')
    await page.waitForTimeout(1000)
    await dismissCookieBanner(page)

    const bar = await bottomBar(page)
    expect(bar).toBeTruthy()

    // 滚到底：页面最后一行内容不该被固定栏盖住
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(600)

    /**
     * 判据用**内容区的底部留白**，不用"最后一行有没有被盖住"。
     *
     * 后者取决于内容有多长：内容短的时候根本滚不到固定栏下面 → 断言恒过。
     * 留白是**结构性的**：内容区底部必须留出固定栏那么高，
     * 不管内容多长都不会被盖住。
     */
    const padding = await page.evaluate(() => {
      const content = document.querySelector('[data-testid="product-detail-content"]')
      const barEl = [...document.querySelectorAll('div')].filter(el => {
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed') return false
        const r = el.getBoundingClientRect()
        if (!(r.bottom >= window.innerHeight - 2 && r.height > 40 && r.height < window.innerHeight * 0.4)) return false
        return !!el.querySelector('[data-testid="product-buy-now-bar"]')
      })[0]
      if (!content || !barEl) return { paddingBottom: 0, barHeight: 0 }
      return {
        paddingBottom: parseFloat(getComputedStyle(content).paddingBottom) || 0,
        barHeight: Math.round(barEl.getBoundingClientRect().height)
      }
    })
    expect(
      padding.paddingBottom,
      `内容区底部留白 ${padding.paddingBottom}px 应 ≥ 固定栏高度 ${padding.barHeight}px` +
      '（否则内容会被固定栏盖住）'
    ).toBeGreaterThanOrEqual(padding.barHeight)
  })

  test('MB-3 桌面宽度下没有固定栏', async ({ page, viewport }) => {
    // 移动端 project 的视口是设备模拟，**改不动**（setViewportSize 无效）
    // → 这一条只在桌面 project 跑
    test.skip(viewport.width < 700, '固定栏在手机宽度下本来就该有，这条只查桌面')
    await page.setViewportSize(DESKTOP)
    await page.goto(`/portal/products/${await firstProductId(page)}`)
    await page.waitForSelector('[data-testid="product-detail-content"]')
    await page.waitForTimeout(1000)
    await dismissCookieBanner(page)

    // 页内那组按钮：桌面端可见（只有它）
    const visibleBuyBtns = await page.locator('[data-testid="product-buy-now"]').filter({ visible: true }).count()
    expect(visibleBuyBtns, '桌面端应只有页内那一组按钮可见').toBe(1)

    // 固定栏：桌面端必须**不可见**
    const barBuyBtns = await page.locator('[data-testid="product-buy-now-bar"]').filter({ visible: true }).count()
    expect(barBuyBtns, '桌面端不应有固定购买栏').toBe(0)
    expect(await bottomBar(page), '桌面端不应有固定购买栏').toBeFalsy()
  })

  test('MB-4 固定栏里的「加入购物车」能打到加购接口', async ({ page, request }) => {
    await page.setViewportSize(MOBILE)

    /**
     * 用**基线商品**，但**先清空购物车**。
     *
     * 为什么不能直接用：购物车里已经有它时（另一个 project 的用例先加过），
     * store 会**本地**改数量、**不再发请求** → 这条用例就变成
     * "等一个永远不会来的请求" → 随机飘红。
     *
     * 为什么不清成"自己造一个商品"：造出来的商品会排到首页第一屏
     * （首页按 created_at 倒序、每页 8 条）→ 把基线商品挤出第一屏
     * → `storefrontFirstPaint` 的 SF-1 挂掉。
     * **清空购物车**没有这个问题。
     */
    // 登录用户加购（游客加购累计到阈值会要验证码，测的就不是"固定栏能不能用"了）
    const login = await request.post('/api/users/login', {
      data: { country_code: '+66', phone: '812345678', password: 'Portal#2026' }
    })
    expect(login.status(), '门户用户登录失败').toBe(200)
    const auth = (await login.json()).data
    await page.addInitScript((a) => {
      localStorage.setItem('token', a.token)
      localStorage.setItem('user', JSON.stringify(a.user))
    }, auth)

    // 先把购物车清空 → 保证这次加购一定会发请求
    await request.delete('/api/cart', { headers: { Authorization: `Bearer ${auth.token}` } })

    {
      await page.goto(`/portal/products/${await firstProductId(page)}`)
      await page.waitForSelector('[data-testid="product-detail-content"]')
      await page.waitForTimeout(1200)
      await dismissCookieBanner(page)

      const addBtn = page.getByTestId('product-add-to-cart-bar').filter({ visible: true })
      await expect(addBtn).toBeVisible({ timeout: 15_000 })

      /**
       * 判据用**接口响应**，不用页面上的角标/提示：
       * 提示条会自动消失，角标还要等购物车 store 刷新 —— 都会让这条断言时序敏感。
       * "固定栏的按钮确实打到了加购接口"才是这条护栏要守的东西。
       */
      const [posted] = await Promise.all([
        page.waitForResponse(
          r => r.url().includes('/api/cart') && r.request().method() === 'POST',
          { timeout: 30_000 }
        ),
        addBtn.click()
      ])
      expect(posted.status(), '固定栏的「加入购物车」应真的打到加购接口').toBe(200)
      const body = await posted.json()
      expect(body.success, '加购应成功').toBe(true)
    }
  })
})
