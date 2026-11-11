/**
 * 门户：v-motion 指令按需注册后的行为验证
 *
 * @vueuse/motion 从"全局插件"改成"组件内局部 import"之后，
 * 入口 chunk 从 309KB 降到 274KB（gzip 118KB → 105KB）——
 * 但如果局部注册没生效，动画会**静默失效**（元素不再有 transform/opacity），
 * 页面照常渲染、测试也照样过 —— 所以要专门断言动画还在。
 *
 *   VM-1 首页商品卡有入场动画的 transform/opacity（指令确实生效了）
 *   VM-2 局部注册没有产生 Vue 的 "Failed to resolve directive" 警告
 */
import { test, expect } from '@playwright/test'

test.describe('门户动画指令（按需注册后）', () => {
  test('VM-1 首页商品卡仍有入场动画', async ({ page }) => {
    const warnings = []
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text())
    })

    await page.goto('/portal/')
    await page.waitForLoadState('domcontentloaded')
    // 等商品渲染出来
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1200)

    const motion = await page.evaluate(() => {
      // 有 transform / opacity 内联样式的元素 = 动画指令生效了
      const animated = [...document.querySelectorAll('*')].filter(el => {
        const s = el.getAttribute('style') || ''
        return /transform|opacity/.test(s)
      }).length
      const cards = document.querySelectorAll('h3').length
      return { animated, cards }
    })

    expect(motion.cards, '首页应有商品卡').toBeGreaterThan(0)
    expect(motion.animated, '商品卡应有动画样式（v-motion 指令生效）').toBeGreaterThan(0)

    // 不能有"指令解析失败"的警告
    const unresolved = warnings.filter(w => /Failed to resolve directive|resolve directive/i.test(w))
    expect(unresolved, `指令解析失败：${unresolved.join(' | ')}`).toEqual([])
  })
})
