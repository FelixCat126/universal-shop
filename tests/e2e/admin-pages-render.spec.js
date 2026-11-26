/**
 * 管理后台：每个页面都能正常打开（第 54 轮）
 * ==============================================
 *
 * ## 为什么需要这条
 *
 * 管理后台的页面用的是 **`setup()` 模式**（不是 `<script setup>`），
 * 模板能访问的只有 `setup()` **return 里列出的**东西。
 *
 * 新加一个函数（比如给列表加一列"内容完整度"标记）却忘了写进 return →
 * 模板渲染时抛 `xxx is not a function` → Vue 的兜底遮罩弹出
 * 「页面出了点问题」→ **整个管理后台白屏**（侧栏还在，内容区全废）。
 *
 * 而且它**不会在 lint 里暴露**（模板里的标识符解析不出来），
 * 单元测试也测不到（管理端没有组件测试）——
 * 只有真的打开那个页面才会炸。
 *
 * 第 54 轮就踩了这个：新增 `missingContent` 忘了 return →
 * CSV 导入等多个 e2e 一起挂（表现是"页面出了点问题"）。
 *
 * ## 这条用例做什么
 *
 * 遍历管理后台的**全部路由**，逐个断言：
 *   1. 页面**没有**出现致命错误遮罩（"页面出了点问题"）
 *   2. 没有未捕获的页面异常
 */
import { test, expect } from '@playwright/test'

/** 管理后台的全部页面（与 src/admin/router/index.js 保持一致） */
const ADMIN_PAGES = [
  '/admin/dashboard',
  '/admin/products',
  '/admin/product-categories',
  '/admin/promotions',
  '/admin/bundles',
  '/admin/coupon-templates',
  '/admin/orders',
  '/admin/after-sales',
  '/admin/payment-reconciliation',
  '/admin/users',
  '/admin/points',
  '/admin/partners',
  '/admin/partner-orders',
  '/admin/operators',
  '/admin/audit-logs',
  '/admin/operation-logs',
  '/admin/system-config'
]

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.waitForLoadState('domcontentloaded')
  await page.getByPlaceholder(/用户名|账号|username/i).fill('e2e_admin')
  await page.getByPlaceholder(/密码|password/i).fill('E2eAdmin#2026')
  await page.getByRole('button', { name: /登录|登 录|立即登录/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

test.describe('管理后台页面可用性', () => {
  test.setTimeout(180_000)

  test('AP-1 每个页面都能打开，没有致命错误', async ({ page }) => {
    // 收集页面级异常（渲染期抛出的错误）
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)))

    await loginAdmin(page)

    for (const p of ADMIN_PAGES) {
      pageErrors.length = 0
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      // 等页面渲染完（列表要拉数据）
      await page.waitForTimeout(1200)

      // 致命错误遮罩：App.vue 的兜底
      const fatal = page.getByText(/页面出了点问题|出点问题|Something went wrong/i)
      await expect(
        fatal.first(),
        `${p} 出现了致命错误遮罩 —— 模板引用了不在 setup() return 里的标识符，` +
        '或该页面本身有异常。管理后台是 setup() 模式，新加的函数必须写进 return。' +
        `\n页面异常：${pageErrors.join(' | ') || '(无)'}`
      ).toHaveCount(0)
    }
  })
})
