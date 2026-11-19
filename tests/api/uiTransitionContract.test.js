/**
 * 页面切换体验的**静态契约**（第 37 轮）
 *
 * ## 为什么一部分检查不做成浏览器断言
 *
 * E2E 里可以测"切页时没有空白帧、没有位移"（真实渲染，见
 * tests/e2e/pageTransitionSmoothness.spec.js）。但"三端都用了重叠式过渡"
 * "三端都接入了 chunk 预取"这类**结构约定**，用 DOM 探测很脆弱：
 *   - 构建产物里类名被压缩/改名就误报
 *   - 页面还没渲染出来就查不到
 * 所以这部分改成**读源码做契约检查**：约定写在哪里，就检查那里。
 *
 * ## 用例
 *   UC-1 三端都不再用 mode="out-in"（out-in 会产生空白帧）
 *   UC-2 三端都有 route-stage 容器 + page-shell 类（重叠式过渡的载体）
 *   UC-3 三端都接入了 useRoutePrefetch（chunk 预取）
 *   UC-4 预取工具在共享目录 src/utils/ 下（三端共用一份，不各写一份）
 *   UC-5 portal 首页有"空闲预取"（商品卡是 div @click，hover 委托抓不到）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const FRONTENDS = [
  { name: '客户门户', app: 'src/portal/App.vue' },
  { name: '管理后台', app: 'src/admin/App.vue' },
  { name: '合作方门户', app: 'src/partner/App.vue' }
]

describe('页面切换体验的静态契约', () => {
  it('UC-1 三端都不再用 mode="out-in"', () => {
    for (const f of FRONTENDS) {
      const text = read(f.app)
      /**
       * 只看 **<Transition> 标签上**有没有 mode="out-in" ——
       * 注释里提到 out-in（解释为什么去掉它）不算，否则会误报。
       */
      const transitionTags = text.match(/<Transition[^>]*>/g) || []
      const withOutIn = transitionTags.filter(t => t.includes('out-in'))
      expect(
        withOutIn,
        `${f.name} 的 <Transition> 仍带 mode="out-in"（会产生空白帧）：${withOutIn.join(' ')}`
      ).toEqual([])
    }
  })

  it('UC-2 三端都有 route-stage 容器与 page-shell 类', () => {
    for (const f of FRONTENDS) {
      const text = read(f.app)
      expect(text.includes('route-stage'), `${f.name} 缺 route-stage 容器：${f.app}`).toBeTruthy()
      expect(text.includes('page-shell'), `${f.name} 缺 page-shell 类（离开页需不透明背景）：${f.app}`).toBeTruthy()
    }
  })

  it('UC-3 三端都接入了 useRoutePrefetch', () => {
    for (const f of FRONTENDS) {
      const text = read(f.app)
      expect(text.includes('useRoutePrefetch'), `${f.name} 未接入路由预取：${f.app}`).toBeTruthy()
      // 调用不能被注释掉
      const call = text.split('\n').find(l => l.includes('useRoutePrefetch(router)') && !l.trim().startsWith('//'))
      expect(call, `${f.name} 的 useRoutePrefetch(router) 调用被注释掉了：${f.app}`).toBeTruthy()
    }
  })

  it('UC-4 预取工具在共享目录 src/utils/ 下（三端共用一份）', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/utils/routePrefetch.js')), 'src/utils/routePrefetch.js 应存在').toBeTruthy()
    // 三端都应从共享目录引用，而不是各写一份
    for (const f of FRONTENDS) {
      const text = read(f.app)
      expect(text.includes("'../utils/routePrefetch.js'"), `${f.name} 应从共享目录引用预取工具：${f.app}`).toBeTruthy()
    }
    // 各端目录里不该有重复副本
    for (const p of ['src/portal/utils/routePrefetch.js', 'src/admin/utils/routePrefetch.js', 'src/partner/utils/routePrefetch.js']) {
      expect(fs.existsSync(path.join(ROOT, p)), `${p} 是重复副本，应只用共享目录那一份`).toBe(false)
    }
  })

  it('UC-5 portal 首页有"空闲预取"（商品卡是 div @click，hover 委托抓不到）', () => {
    const text = read('src/portal/views/Home.vue')
    expect(text.includes('prefetchRoutesWhenIdle'), '首页未接入空闲预取').toBeTruthy()
    expect(text.includes("'ProductDetail'"), '空闲预取应至少包含商品详情页').toBeTruthy()
    // 工具本身要提供这两个能力
    const tool = read('src/utils/routePrefetch.js')
    expect(tool.includes('export function prefetchRouteByName'), '预取工具缺少按名预取').toBeTruthy()
    expect(tool.includes('export function prefetchRoutesWhenIdle'), '预取工具缺少空闲预取').toBeTruthy()
  })
})
