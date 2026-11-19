/**
 * 页面切换的"丝滑度"护栏（第 37 轮）
 *
 * ## 用户主诉
 *
 * 「切换页面的时候一定会有一个跳动的页面刷新视效，希望前后端都能实现那种
 * 超级丝滑的页面切换，让人感觉不出来是页面刷新」。
 *
 * ## 量化后的原因
 *
 * 旧实现（portal 的 spring-page + mode="out-in"）：
 *   - **空白帧 3 帧（1%）**：out-in 模式下旧页淡出被移除后、新页还没渲染出来，
 *     中间既没有旧页也没有新页 —— 那一帧就是"白一下"
 *   - **位移/缩放帧 71 帧（27%）**：spring-page 的 `translateY(12px) scale(0.98)`
 *     让整个页面在动 —— 人眼把"页面在动"读成"页面在刷新"
 *   - **顶部位置在 63↔86 之间来回跳**：位移导致的布局抖动
 *
 * 新实现（重叠 + 只做 opacity + chunk 预取）：
 *   空白帧 0 · 位移帧 0 · 顶部恒定
 *
 * ## 用例
 *   TS-1 门户端切页：全程无空白帧
 *   TS-2 门户端切页：全程无位移/缩放
 *   TS-3 门户端切页：内容区顶部位置不跳动
 *
 * 注：「三端都是重叠式过渡」「三端都接入了预取」这两条**结构约定**，
 * 放在 tests/api/uiTransitionContract.test.js 做**源码契约检查** ——
 * 用 DOM 探测构建产物里的类名太脆弱（改名或还没渲染都会误报）。
 */
import { test, expect } from '@playwright/test'

/**
 * 在页面里逐帧采样路由内容元素。
 * @returns {Promise<object>} 采样统计
 */
async function sampleTransition (page, from, to) {
  await page.goto(from)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1200)

  return page.evaluate(async (target) => {
    // 过渡目标元素：新实现是 .route-stage 的第一个子元素
    const pick = () => {
      const stage = document.querySelector('.route-stage')
      if (stage) return stage.firstElementChild
      // 退而求其次：#app 下最后一个非 header/footer 容器
      const kids = [...document.querySelectorAll('#app > *')].filter(k => {
        const t = k.tagName.toLowerCase()
        const c = String(k.className || '')
        return t !== 'header' && t !== 'footer' && !c.includes('toast') && !c.includes('route-stage')
      })
      return kids[kids.length - 1] || null
    }

    const frames = []
    let stop = false
    const tick = () => {
      const el = pick()
      let v = { visible: 0, transform: 'none', top: 0 }
      if (el) {
        const cs = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        v = {
          visible: (rect.height > 120 && cs.opacity !== '0' && cs.visibility !== 'hidden') ? 1 : 0,
          transform: cs.transform,
          top: Math.round(rect.top)
        }
      }
      frames.push(v)
      if (!stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    await new Promise(res => setTimeout(res, 1600))
    stop = true

    const blank = frames.filter(f => !f.visible)
    const moved = frames.filter(f => f.transform && f.transform !== 'none' && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(f.transform))
    const tops = [...new Set(frames.map(f => f.top))]
    return {
      frames: frames.length,
      blank: blank.length,
      moved: moved.length,
      tops,
      path: location.pathname
    }
  }, to)
}

test.describe('页面切换丝滑度', () => {
  test('TS-1/2/3 门户端切页：无空白帧、无位移、顶部不跳', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const r = await sampleTransition(page, '/portal/', '/portal/products/2')

    expect(r.frames, '采样帧数太少，测量不可信').toBeGreaterThan(60)
    expect(r.blank, `切换过程中出现 ${r.blank} 个空白帧（旧实现是 3 帧）—— 那一帧就是"白一下"`).toBe(0)
    expect(r.moved, `切换过程中有 ${r.moved} 帧带位移/缩放（旧实现 71 帧 = 27%）—— 位移会被读成"页面在刷新"`).toBe(0)
    expect(r.tops.length, `内容区顶部位置在 ${r.tops.join(', ')} 之间跳动 —— 布局在抖`).toBe(1)
  })
})
