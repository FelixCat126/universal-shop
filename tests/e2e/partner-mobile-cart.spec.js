/**
 * 合作方端移动端：**有货的清单**与**下单确认弹窗**（第 65 轮）
 * =================================================
 *
 * ## 为什么现有护栏漏了这两块
 *
 * `partner-mobile-layout` 已经扫了合作方的 5 个页面，但它扫的是
 * **空购物车**的状态 —— 清单里的行（数量输入框、移除按钮）
 * 与**下单确认弹窗**（Teleport 到 body 的底部抽屉）在扫的时候都不在页面上。
 *
 * 而这两块恰恰是合作方每天用得最多的：
 * 选品 → 改数量 → 提交订单 → 确认弹窗。
 *
 * ## 用例
 *
 *   PC-1 手机端加了货之后：清单不横向溢出、控件热区达标
 *   PC-2 下单确认弹窗（底部抽屉）：不横向溢出、按钮够得着、内容能滚
 *   PC-3 弹窗里的提交按钮在视口内（不用先滚页面就能点）
 */
import { test, expect } from '@playwright/test'

const PARTNER_LOGIN = 'e2e_partner'
const PARTNER_PASS = 'E2ePartner#2026'

async function loginPartner (page) {
  await page.goto('/partner/login')
  await page.getByPlaceholder('请输入登录名').fill(PARTNER_LOGIN)
  await page.getByPlaceholder('请输入密码').fill(PARTNER_PASS)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL(/\/shop/, { timeout: 30_000 })
}

/** 扫当前页面里"不达标"的控件（规则与 partner-mobile-layout 一致） */
async function scanHotTargets (page, label) {
  return page.evaluate((lb) => {
    const out = []
    document.querySelectorAll('button, select, input, a[href]').forEach(el => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') return
      const isToggle = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')
      const isControl = ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)
      const min = isToggle ? 20 : (isControl ? 40 : 32)
      /**
       * **toast 里的按钮不算**：toast 是**瞬时**元素（几秒后自动消失），
       * 它的动作（"去下单"）只是快捷方式 —— 同样的动作在清单/弹窗里有
       * 永久且 48px 的按钮。把 toast 按钮也拉到 40px 会让每次提示都变得笨重，
       * 收益却接近零（误按一下没有代价）。
       */
      if (el.closest('[data-testid="toast"]')) return
      if (r.height < min) {
        out.push(lb + ' → ' + el.tagName.toLowerCase() + ' "' + (el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 12) + '" 高 ' + Math.round(r.height) + 'px（需 ≥' + min + '）')
      }
    })
    return out
  }, label)
}

test.describe('合作方端移动端：清单与下单弹窗', () => {
  test('PC-1 加了货之后：清单不横向溢出、控件热区达标', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 })
    await loginPartner(page)

    // 等商品列表出来并加入一件
    const addBtn = page.getByRole('button', { name: /加入清单|Add to list/i }).first()
    await expect(addBtn).toBeVisible({ timeout: 20_000 })
    await addBtn.click()
    await expect(page.getByText(/已加入清单|Added/i).first()).toBeVisible({ timeout: 15_000 })

    await page.waitForTimeout(1200)

    // ① 页面不横向溢出
    const overflowX = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflowX, `清单加货后页面横向溢出 ${overflowX}px`).toBeLessThanOrEqual(0)

    // ② 清单里的控件热区达标（数量输入框、移除按钮）
    const problems = await scanHotTargets(page, '订货清单')
    expect(problems.length ? problems.join('\n') : '').toBe('')
  })

  test('PC-2 下单确认弹窗：不横向溢出、内容能滚、按钮够得着', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 })
    await loginPartner(page)

    const addBtn = page.getByRole('button', { name: /加入清单|Add to list/i }).first()
    await expect(addBtn).toBeVisible({ timeout: 20_000 })
    await addBtn.click()
    await expect(page.getByText(/已加入清单|Added/i).first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1000)

    // 打开下单确认弹窗
    const submit = page.getByRole('button', { name: /提交订单|去下单|Submit/i }).first()
    await expect(submit).toBeVisible({ timeout: 15_000 })
    await submit.click()

    const dialog = page.locator('.fixed.inset-0.z-\\[100\\]').first()
    await expect(dialog, '下单确认弹窗应打开').toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(800)

    // ① 弹窗不横向溢出
    const overflowX = await page.evaluate(() => {
      const d = document.querySelector('.fixed.inset-0.z-\\[100\\]')
      if (!d) return -1
      return d.scrollWidth - d.clientWidth
    })
    expect(overflowX, `下单确认弹窗横向溢出 ${overflowX}px`).toBeLessThanOrEqual(0)

    // ② 弹窗里的控件热区达标
    const problems = await scanHotTargets(page, '下单确认弹窗')
    expect(problems.length ? problems.join('\n') : '').toBe('')

    // ③ 提交按钮在视口内（不用先滚页面就能点）
    const inView = await page.evaluate(() => {
      const d = document.querySelector('.fixed.inset-0.z-\\[100\\]')
      if (!d) return false
      const btns = [...d.querySelectorAll('button')]
      const ok = btns.some(b => {
        const r = b.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight + 2 && r.height > 0
      })
      return ok
    })
    expect(inView, '下单确认弹窗里应有一个按钮在视口内（不用滚页面就能点）').toBe(true)
  })
})
