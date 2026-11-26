/**
 * e2e 公共辅助（第 54 轮）
 * =======================
 */

/**
 * 勾选「条款与年龄确认」（第 54 轮新增的必填确认项）。
 *
 * ## 为什么需要这个 helper
 *
 * 注册页与结算页现在都要求用户勾选两个确认框：
 *   - 已阅读服务条款 / 退换货政策 / 隐私政策
 *   - 已满最低购买年龄（20 周岁）
 *
 * 服务端是**强制**的（Joi 层 `valid(true).required()`），
 * 所以不勾就点提交 → 直接 400，E2E 会失败。
 *
 * ## 三个容易踩的坑
 *
 * 1. **时序**：结算页要先渲染地址表单，勾选框可能还没出现就去找了。
 *    所以这里**等它出现**，而不是"找不到就跳过"——
 *    跳过会让下游下单 400，症状离原因很远（表现为"下单后没跳转"）。
 * 2. **语言**：勾选框的文字随语言变（三语），按文字定位会在切换语言后失效。
 *    所以用 `input[type=checkbox]` 按**顺序**定位（第一个 = 年龄，第二个 = 条款）。
 * 3. **必须走真实点击**：Vue 的 v-model 靠 **change 事件**更新。
 *    直接 `evaluate` 设置 `el.checked = true` 不会触发 change →
 *    界面看着勾上了，`orderForm.termsAccepted` 仍是 false → 下单照样 400。
 *
 * @param {import('@playwright/test').Page} page
 */
export async function acceptConsent (page) {
  const boxes = page.locator('input[type="checkbox"]')

  // 等勾选框出现（结算页要先渲染地址表单）
  try {
    await boxes.first().waitFor({ state: 'attached', timeout: 10_000 })
  } catch {
    // 真的没有勾选框（比如这个页面不需要确认）→ 不强行操作
    return
  }

  const count = await boxes.count()
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i)
    if (await box.isChecked()) continue
    try {
      await box.click({ timeout: 5000 })
    } catch {
      // 点击失败（不可见/被遮挡/动画中）→ 兜底：直接置 checked 并**派发 change**
      // （Vue 的 v-model 只认 change 事件，所以必须派发，不能只改属性）
      await box.evaluate((el) => {
        el.checked = true
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }).catch(() => {})
    }
  }

  // 勾完**校验**：没勾上就早失败，别让错误飘到"下单后没跳转"那么远的地方
  const stillUnchecked = []
  for (let i = 0; i < count; i++) {
    if (!(await boxes.nth(i).isChecked())) stillUnchecked.push(i)
  }
  if (stillUnchecked.length) {
    const details = []
    for (const i of stillUnchecked) {
      const el = boxes.nth(i)
      details.push(
        `#${i} visible=${await el.isVisible()} disabled=${await el.isDisabled()}`
      )
    }
    throw new Error(
      `条款/年龄确认没勾上（${details.join(', ')}）—— ` +
      '服务端会返回 400 CONSENT_REQUIRED，后面会表现为"下单后没跳转"'
    )
  }
}
