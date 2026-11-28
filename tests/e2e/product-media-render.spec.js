/**
 * 商品图片的渲染（第 56 轮 · 渲染效果）
 * ==========================================
 *
 * ## 要防的是什么
 *
 * 商品卡的图片容器是 `aspect-square`（正方形），
 * 但里面的 `<img>` 只有 `h-48`（固定高度）—— 于是：
 *
 *   - 图片**没有填满**容器 → 卡片下方露出一条空灰带（实测 94px）
 *   - 图片被 `object-cover` **裁掉上下**（正方形图塞进 1.49:1 的框）
 *
 * 详情页主图是同一个毛病：`aspect-square` 容器 + `h-96` 的图
 * → 下方 208px 空白 + 商品图被裁。
 *
 * 用户看到的不是"图片有点小"，而是**每张商品图下面都有一条灰色空带**，
 * 以及商品图被切掉一截（瓶身/logo 少了）。
 *
 * ## 断言为什么这么写
 *
 * - **量"布局尺寸"（offsetHeight）而不是 getBoundingClientRect**：
 *   图片有淡入动画（`transform: scale(1.05)` → 1），
 *   rect 量到的是**动画中的缩放后**尺寸，会比真实布局大 5%
 *   （275px 的框量出 289px），断言会误报。
 * - **"填满"用 gap 判**（图片底边与容器底边的距离 ≤ 2px），
 *   而不是断言某个 CSS 类名 —— 类名会变，用户看到的那条空带不会变。
 * - **"不变形"与"不裁切"分开判**：
 *   `object-fit: fill` 才会拉变形；`cover` 会等比缩放后**裁掉多出来的部分**。
 *   两种都要防，所以分别断言。
 * - **用一张真图（800×600）来测**：占位图是 data-URI 的 SVG，
 *   浏览器给不出 naturalWidth（实测为 0），没法判断裁切。
 *   这里用 `page.route` 拦一张 sharp 现生成的 PNG —— 不落盘、不污染仓库。
 * - 断言跑在**所有**卡片上，不只第一张 —— 布局 bug 常常只在某一张上出现。
 */
import { test, expect } from '@playwright/test'
import sharp from 'sharp'

/** 三种语言的「商品描述」标题（e2e 默认语言是泰语） */
const DESCRIPTION_HEADINGS = ['Product Description', '产品描述', 'รายละเอียดสินค้า']

/** 夹具图 URL（被 page.route 拦截，不会真的去磁盘上找） */
const FIXTURE_IMAGE = '/uploads/products/e2e-fixture-800x600.png'

/** 登录管理端拿 token */
async function adminToken (request) {
  const login = await request.post('/api/admin/login', {
    data: { username: 'e2e_admin', password: 'E2eAdmin#2026' }
  })
  expect(login.status(), '管理端登录失败').toBe(200)
  return (await login.json()).data.token
}

/** 拿一个可用分类（商品必填 category_id） */
async function someCategoryId (request) {
  const res = await request.get('/api/product-categories')
  expect(res.status()).toBe(200)
  const list = (await res.json())?.data || []
  expect(list.length, '基线里应有分类').toBeGreaterThan(0)
  return list[0].id
}

/** 造一个带真图路径的商品 */
async function createProduct (request, token, overrides = {}) {
  const categoryId = overrides.category_id ?? await someCategoryId(request)
  const created = await request.post('/api/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'E2E 图文渲染夹具',
      name_th: 'E2E Media Fixture',
      description: 'E2E 渲染夹具商品',
      price: 99,
      stock: 10,
      status: 'active',
      image: FIXTURE_IMAGE,
      category_id: categoryId,
      ...overrides
    }
  })
  expect(created.status(), `创建商品失败：${created.status()}`).toBe(201)
  return (await created.json()).data
}

/** 把 /uploads/products/** 拦下来，返回一张真 PNG（800×600，非方形） */
async function serveFixtureImage (page) {
  const png = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 32, g: 120, b: 200 } }
  }).png().toBuffer()
  await page.route('**/uploads/products/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png })
  )
}

/** 首页所有商品卡的「图片 vs 方框」几何 */
async function cardGeometries (page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('a[href*="/portal/products/"] img')]
    return cards.map(img => {
      const frame = img.parentElement
      const link = img.closest('a[href*="/portal/products/"]')
      return {
        href: link ? link.getAttribute('href') : '(未知)',
        imgW: img.offsetWidth,
        imgH: img.offsetHeight,
        frameW: frame.offsetWidth,
        frameH: frame.offsetHeight,
        gapBottom: frame.offsetHeight - (img.offsetTop + img.offsetHeight),
        loaded: img.complete && img.naturalWidth > 0,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        objectFit: getComputedStyle(img).objectFit
      }
    })
  })
}

/** 详情页主图的几何 */
async function heroGeometry (page) {
  return page.evaluate(() => {
    const img = document.querySelector('[data-testid="product-detail-content"] img')
    if (!img) return null
    const frame = img.parentElement
    return {
      imgW: img.offsetWidth,
      imgH: img.offsetHeight,
      frameW: frame.offsetWidth,
      frameH: frame.offsetHeight,
      gapBottom: frame.offsetHeight - (img.offsetTop + img.offsetHeight),
      loaded: img.complete && img.naturalWidth > 0,
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      objectFit: getComputedStyle(img).objectFit
    }
  })
}

/** 图片被拉变形了吗（只有 object-fit: fill 才会） */
function isDistorted (g) {
  if (!g || !g.loaded) return false
  if (g.objectFit === 'fill') {
    const boxRatio = g.imgW / g.imgH
    const natRatio = g.naturalW / g.naturalH
    return Math.abs(boxRatio - natRatio) > 0.05
  }
  return false
}

/** 商品图被裁掉了吗（cover 且容器与原图比例不同 → 会裁） */
function isCropped (g) {
  if (!g || !g.loaded) return false
  if (g.objectFit === 'contain') return false
  const frameRatio = g.frameW / g.frameH
  const natRatio = g.naturalW / g.naturalH
  return Math.abs(frameRatio - natRatio) > 0.05
}

test.describe('商品图片渲染', () => {
  test('PM-1 商品卡：图片必须填满自己的方框（不留空灰带）', async ({ page }) => {
    await page.goto('/portal/')
    await page.waitForSelector('a[href*="/portal/products/"] img')

    const cards = await cardGeometries(page)
    expect(cards.length, '首页应有商品卡').toBeGreaterThan(0)

    for (const c of cards) {
      expect(
        c.gapBottom,
        `商品卡 ${c.href}：图片没填满方框，下方留了 ${Math.round(c.gapBottom)}px 空带`
      ).toBeLessThanOrEqual(2)
      expect(
        Math.abs(c.imgH - c.frameH),
        `商品卡 ${c.href}：图片高 ${c.imgH} 与方框高 ${c.frameH} 不一致`
      ).toBeLessThanOrEqual(2)
    }
  })

  test('PM-2 商品卡：商品图不能被裁掉、也不能被拉变形', async ({ page, request }) => {
    const token = await adminToken(request)
    const product = await createProduct(request, token)
    try {
      await serveFixtureImage(page)
      await page.goto('/portal/')
      await page.waitForSelector(`a[href*="/portal/products/${product.id}"] img`)

      const card = await page.evaluate((id) => {
        const link = document.querySelector(`a[href*="/portal/products/${id}"]`)
        const img = link && link.querySelector('img')
        if (!img) return null
        const frame = img.parentElement
        return {
          imgW: img.offsetWidth,
          imgH: img.offsetHeight,
          frameW: frame.offsetWidth,
          frameH: frame.offsetHeight,
          gapBottom: frame.offsetHeight - (img.offsetTop + img.offsetHeight),
          loaded: img.complete && img.naturalWidth > 0,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          objectFit: getComputedStyle(img).objectFit
        }
      }, product.id)

      expect(card, '夹具商品没出现在首页').toBeTruthy()
      expect(card.loaded, '夹具图没加载出来（naturalWidth=0）').toBe(true)
      // 夹具图必须**非正方形**（4:3）—— 正方形图塞进正方形框看不出裁切
      expect(
        card.naturalW / card.naturalH,
        `夹具图应是 4:3（实测 ${card.naturalW}x${card.naturalH}）`
      ).toBeCloseTo(4 / 3, 2)
      expect(
        card.gapBottom,
        `商品卡：图片没填满方框，下方留了 ${Math.round(card.gapBottom)}px 空带`
      ).toBeLessThanOrEqual(2)
      expect(isCropped(card), `商品图被裁掉了（object-fit=${card.objectFit}）`).toBe(false)
      expect(isDistorted(card), `商品图被拉变形了（object-fit=${card.objectFit}）`).toBe(false)
    } finally {
      await request.delete(`/api/products/${product.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {})
    }
  })

  test('PM-3 详情页主图：同样填满方框、不能被裁变形', async ({ page, request }) => {
    const token = await adminToken(request)
    const product = await createProduct(request, token)
    try {
      await serveFixtureImage(page)
      await page.goto(`/portal/products/${product.id}`)
      // 用稳定的 data-testid，而不是 .page-shell ——
      // 详情页是多根组件，class 透传不到它身上（Vue 只在单根时透传）
      await page.waitForSelector('[data-testid="product-detail-content"] img')
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-testid="product-detail-content"] img')
        return img && img.complete && img.naturalWidth > 0
      }, null, { timeout: 15_000 }).catch(() => {})

      const hero = await heroGeometry(page)
      expect(hero, '详情页应有主图').toBeTruthy()
      expect(
        hero.gapBottom,
        `详情页主图没填满方框，下方留了 ${Math.round(hero.gapBottom)}px 空白`
      ).toBeLessThanOrEqual(2)
      expect(isCropped(hero), `详情页主图被裁掉了（object-fit=${hero.objectFit}）`).toBe(false)
      expect(isDistorted(hero), `详情页主图被拉变形了（object-fit=${hero.objectFit}）`).toBe(false)
    } finally {
      await request.delete(`/api/products/${product.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {})
    }
  })

  test('PM-4 详情页：描述为空时**不渲染**「商品描述」标题', async ({ page, request }) => {
    const token = await adminToken(request)
    const withDesc = await createProduct(request, token, { description: 'E2E 有描述的夹具商品' })
    const withoutDesc = await createProduct(request, token, {
      name: 'E2E 无描述商品',
      name_th: 'E2E No Description',
      description: ''
    })

    try {
      const heading = page.getByRole('heading', { name: new RegExp(DESCRIPTION_HEADINGS.join('|')) })

      // 有描述 → 标题必须在（否则运营写了描述也看不见）
      await page.goto(`/portal/products/${withDesc.id}`)
      await page.waitForSelector('[data-testid="product-detail-content"]')
      await expect(
        heading.first(),
        '有描述时必须显示描述标题'
      ).toBeVisible({ timeout: 15_000 })

      // 空描述 → 标题必须不出现（空标题下面什么都没有，像是页面坏了）
      await page.goto(`/portal/products/${withoutDesc.id}`)
      await page.waitForSelector('[data-testid="product-detail-content"]')
      // 等接口回来（标题是数据到位后才渲染的）
      await page.waitForTimeout(1200)
      await expect(
        heading.first(),
        '描述为空时还渲染「商品描述」标题 —— 客户看到一个空标题下面什么都没有'
      ).toHaveCount(0)
    } finally {
      for (const p of [withDesc, withoutDesc]) {
        await request.delete(`/api/products/${p.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {})
      }
    }
  })
})
