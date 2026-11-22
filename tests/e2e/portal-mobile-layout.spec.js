/**
 * 门户移动端布局护栏（390px 视口）
 *
 * ## 为什么要有这条
 *
 * 第 31 轮用真机视口实测发现：商品卡底部的两个按钮并排时，
 * 390px 宽的卡片里每个按钮只剩 **65px 内容宽**，
 * "Add to Cart" 被压成 **3 行竖排**，按钮区从 44px 被撑到 **82px** ——
 * 卡片底部白白多出 38px，文字竖排更是完全没法看。
 *
 * 这类问题**单元测试看不见**（DOM 结构没变）、**截图也容易漏**
 * （要正好截到移动视口），所以必须写成**可量化的断言**。
 *
 * ## 用例
 *   ML-1 页面无横向溢出（移动端最常见的"挤爆"）
 *   ML-2 顶栏不溢出容器
 *   ML-3 商品卡按钮文字**单行**（不能竖排）
 *   ML-4 商品卡按钮高度在合理区间（44~56px，不是 82px）
 *   ML-5 同一行卡片的底部按钮对齐
 *   ML-6 可点击控件（button/select/input）的触控热区 ≥ 40px
 *
 * ⚠️ 这些断言都做过反向验证：把布局改回原样（并排 + 固定 min-height）
 *    ML-3 / ML-4 会立刻红。
 */
import { test, expect } from '@playwright/test'

/**
 * 要扫的页面（**不只首页**）。
 *
 * 第 32 轮的教训：第 31 轮的护栏只查首页，于是"详情页/购物车的返回按钮只有 32px"
 * 这类问题一个都没被覆盖到 —— 护栏覆盖面不够，等于只守了大门。
 */
const USER_PHONE = '812345678'
const USER_PASS = 'Portal#2026'

const PORTAL_PAGES = [
  '/portal/',
  '/portal/products/2',   // 真实商品（id=1 是软删商品，详情页会显示"不存在"）
  '/portal/cart',
  '/portal/login',
  '/portal/register',
  '/portal/nonexistent'   // 404 页
]

/** 等首页商品渲染出来 */
async function gotoHomeWithProducts (page) {
  await page.goto('/portal/')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
}

/** 取商品卡里的操作按钮（排除分类 Tab） */
const cardButtons = (page) => page.locator('h3').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').locator('button')

test.describe('门户移动端布局', () => {
  test.beforeEach(async ({ page }) => {
    // 明确用移动视口（Pixel 5 是 393px，这里再钉到 390 复现实测条件）
    await page.setViewportSize({ width: 390, height: 844 })
  })

  /**
   * 横向溢出的**正确判据**（第 50 轮修正）
   *
   * 原来判的是 `scrollWidth <= window.innerWidth` —— 这在移动端**永远成立**：
   * 移动模拟下，页面一旦比屏幕宽，浏览器会把**布局视口一起撑宽**
   * （`window.innerWidth` 跟着内容变），于是 scrollWidth === innerWidth → 判定"没溢出"。
   *
   * 实测（第 50 轮）：个人中心的标签导航撑到 738px，
   * `window.innerWidth` 也变成 738 → 旧判据给绿 ✗，
   * 而真实可见宽度 `visualViewport.width` 只有 390 → 实际溢出 348px。
   *
   * 正确基准是 **`visualViewport.width`**（用户真正能看到的宽度），
   * 拿它跟 scrollWidth 比。桌面 project 里 visualViewport 也有，
   * 于是同一条判据在两个 project 下都成立。
   */
  test('ML-1 各页面无横向溢出', async ({ page }) => {
    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        // 真实可见宽度（移动端下 innerWidth 会跟着内容撑宽，不能用它当基准）
        visibleW: window.visualViewport
          ? Math.round(window.visualViewport.width)
          : window.innerWidth
      }))
      expect(
        m.scrollW,
        `${p} 横向溢出：scrollWidth=${m.scrollW} > 可见宽度 ${m.visibleW}（innerWidth=${m.innerW}，移动端下它会跟着内容撑宽，不能当基准）`
      ).toBeLessThanOrEqual(m.visibleW + 1)
    }
  })

  /**
   * ML-1b 个人中心不横向溢出（第 50 轮）
   *
   * 个人中心**不在** ML-1 的页面列表里 —— 于是它的横向溢出一直没被发现：
   * 标签导航（订单 / 售后 / 地址 / 积分 / 资料，5 个标签 + 32px 间隔 + 图标）
   * 在 393px 的手机上排不下 → 整页被撑到 500px →
   * 连带把「新增地址」弹窗也推出屏幕（弹窗里的「添加」按钮点不到）。
   *
   * 个人中心要登录，所以单独一条用例（先登录再查）。
   */
  test('ML-1b 个人中心（登录后）不横向溢出', async ({ page }) => {
    await page.goto('/portal/login')
    await page.getByPlaceholder(/手机号/).fill(USER_PHONE)
    await page.getByPlaceholder(/密码/).fill(USER_PASS)
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 30_000 })

    await page.goto('/portal/profile')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      visibleW: window.visualViewport ? Math.round(window.visualViewport.width) : window.innerWidth
    }))
    expect(
      m.scrollW,
      `个人中心横向溢出：scrollWidth=${m.scrollW} > 可见宽度 ${m.visibleW}（标签导航排不下时应该自己横向滚，而不是把页面撑宽）`
    ).toBeLessThanOrEqual(m.visibleW + 1)
  })

  /**
   * ML-1c 新增地址弹窗的提交按钮**必须在视口内**（第 50 轮）
   *
   * 这个弹窗在移动端比视口高（内容 ~980px / 视口 ~730px），
   * 容器是 `max-h-[90vh] overflow-y-auto` →
   * 「添加」按钮原本在**滚动区之外**（y≈1053，屏高只有 727）：
   * 用户填完整个表单，**看不到唯一的提交入口**。
   *
   * 修法是把按钮区做成 sticky 底栏。这条用例守住它 ——
   * 一旦有人把 sticky 去掉（或再加几个表单字段把弹窗撑得更高），
   * 它立刻变红。
   */
  test('ML-1c 新增地址弹窗的提交按钮在视口内（不用先滚动就能提交）', async ({ page }) => {
    await page.goto('/portal/login')
    await page.getByPlaceholder(/手机号/).fill(USER_PHONE)
    await page.getByPlaceholder(/密码/).fill(USER_PASS)
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 30_000 })

    // 直接打开新增地址弹窗
    await page.goto('/portal/profile?tab=addresses')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    const addBtn = page.getByRole('button', { name: /新增收货地址|添加收货地址|新增地址|Add address/i }).first()
    await addBtn.click()
    await page.waitForTimeout(800)

    const submit = page.locator('div.fixed.inset-0').getByRole('button', { name: /^(添加|保存|Add|Save)$/ }).last()
    await expect(submit).toBeVisible({ timeout: 10_000 })
    const box = await submit.boundingBox()
    const vh = page.viewportSize().height
    expect(box, '新增地址弹窗里找不到提交按钮').toBeTruthy()
    expect(
      box.y + box.height,
      `提交按钮在视口外（底边 y=${Math.round(box.y + box.height)} > 视口高 ${vh}）—— 用户填完表看不到提交入口`
    ).toBeLessThanOrEqual(vh + 1)
  })

  test('ML-2 顶栏不溢出容器', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const m = await page.evaluate(() => {
      const row = document.querySelector('header .flex.items-center.justify-between')
      if (!row) return null
      const r = row.getBoundingClientRect()
      return { right: r.right, innerW: window.innerWidth, scrollW: row.scrollWidth, clientW: row.clientWidth }
    })
    expect(m, '找不到顶栏行').not.toBeNull()
    expect(m.right, `顶栏超出屏幕：right=${m.right} > ${m.innerW}`).toBeLessThanOrEqual(m.innerW + 1)
    expect(m.scrollW, '顶栏内容宽度超过容器宽度').toBeLessThanOrEqual(m.clientW + 1)
  })

  test('ML-3 商品卡按钮文字是单行（不能竖排）', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const lines = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('h3').forEach((h3) => {
        const card = h3.closest('.rounded-xl')
        if (!card) return
        for (const b of card.querySelectorAll('button')) {
          const range = document.createRange()
          range.selectNodeContents(b)
          const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
          out.push({ text: (b.textContent || '').trim().slice(0, 14), lines: rects.length })
        }
      })
      return out
    })
    expect(lines.length, '没找到商品卡按钮').toBeGreaterThan(0)
    const wrapped = lines.filter(l => l.lines > 1)
    expect(wrapped, `按钮文字被压成多行（竖排）：${JSON.stringify(wrapped)}`).toEqual([])
  })

  test('ML-4 商品卡按钮高度在 44~56px（不是被撑到 80+）', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const heights = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('h3').forEach((h3) => {
        const card = h3.closest('.rounded-xl')
        if (!card) return
        for (const b of card.querySelectorAll('button')) {
          const r = b.getBoundingClientRect()
          if (r.height > 0) out.push({ text: (b.textContent || '').trim().slice(0, 14), h: Math.round(r.height) })
        }
      })
      return out
    })
    expect(heights.length).toBeGreaterThan(0)
    const tooTall = heights.filter(h => h.h > 56)
    expect(tooTall, `按钮被撑高了（文字换行导致）：${JSON.stringify(tooTall)}`).toEqual([])
  })

  test('ML-5 同一行卡片的底部按钮对齐', async ({ page }) => {
    await gotoHomeWithProducts(page)
    const rows = await page.evaluate(() => {
      // 按 top 分组（同一网格行）
      const items = []
      document.querySelectorAll('h3').forEach((h3) => {
        const card = h3.closest('.rounded-xl')
        if (!card) return
        const btns = [...card.querySelectorAll('button')]
        const last = btns[btns.length - 1]
        if (!last) return
        items.push({
          name: (h3.textContent || '').trim().slice(0, 12),
          top: Math.round(card.getBoundingClientRect().top),
          btnBottom: Math.round(last.getBoundingClientRect().bottom)
        })
      })
      const groups = {}
      items.forEach(i => { (groups[i.top] = groups[i.top] || []).push(i) })
      return Object.values(groups).filter(g => g.length > 1)
    })
    for (const g of rows) {
      const bottoms = [...new Set(g.map(i => i.btnBottom))]
      expect(bottoms.length, `同一行卡片的底部按钮没对齐：${JSON.stringify(g)}`).toBe(1)
    }
  })

  /**
   * ML-6 触控热区下限。
   *
   * 分档而不是一刀切 44px：
   *   - button / select / input：**40px**（主要操作控件）
   *   - a[href] 文本链接：**32px**（文字链接本身有文字尺寸，
   *     一律 44px 会让页面被撑得松松垮垮；32px 是可点文本的通行下限）
   * 不可见元素（opacity:0 / visibility:hidden / clip 隐藏的备用 input）不计入。
   *
   * ⚠️ 分档是为了让护栏**能长期保持绿** —— 一个永远红的护栏等于没有护栏。
   *    但"永远绿"的陷阱靠的是**明确的判定依据**，不是放宽阈值。
   */
  test('ML-7 勾选框的 label 触控热区 ≥ 40px（热区由 label 提供）', async ({ page }) => {
    const problems = []
    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const bad = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.opacity === '0') return
          const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
                      el.closest('label')
          if (!lab) { out.push('没有 label：' + (el.id || el.className).slice(0, 30)); return }
          const lr = lab.getBoundingClientRect()
          if (lr.height < 40) out.push('label 热区 ' + Math.round(lr.height) + 'px：' + (el.id || el.className).slice(0, 30))
        })
        return out
      })
      bad.forEach(x => problems.push(p + ' → ' + x))
    }
    expect(problems, `勾选框热区不达标：\n${problems.join('\n')}`).toEqual([])
  })

  test('ML-6 可点击控件触控热区达标（所有门户页面）', async ({ page }) => {
    const problems = []
    for (const p of PORTAL_PAGES) {
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const small = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('button, select, input, a[href]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const cs = getComputedStyle(el)
          // 不可见（视觉隐藏但仍在 DOM 里）的备用控件不算触控目标
          if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.position === 'absolute' && r.width <= 2) return
          const isControl = ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)
          // 原生勾选框/单选框本身只有 ~20px，触控热区由**它的 label** 提供
          // → 单独按 20px 判定，并在下面的用例里断言 label 本身够大
          const isNativeToggle = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')
          const min = isNativeToggle ? 20 : (isControl ? 40 : 32)
          if (r.height < min) {
            out.push(el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 12) + ':' + Math.round(r.height) + '(需≥' + min + ')')
          }
        })
        return out
      })
      small.forEach(x => problems.push(p + ' → ' + x))
    }
    expect(problems, `触控热区不达标：\n${problems.join('\n')}`).toEqual([])
  })
})
