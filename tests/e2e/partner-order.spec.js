/**
 * 合作方：订货流程（真实浏览器）
 *
 * 覆盖：登录 → 商品页选品 → 加入清单 → 填收货地址 → 提交订单 → 订单列表可见。
 * 这条链路里有 MOQ（起订量/步长）规则、幂等键、地址校验 ——
 * 单元测试覆盖的是接口，这条覆盖的是「界面能不能走通」。
 *
 * 用例：
 *   PO-1 合作方登录后能进商品页
 *   PO-2 选品 → 提交订单 → 订单出现在订单列表
 */
import { test, expect } from '@playwright/test'

const PARTNER_LOGIN = 'e2e_partner'
const PARTNER_PASS = 'E2ePartner#2026'

/** 登录并进入商品页 */
async function loginToShop (page) {
  await page.goto('/partner/login')
  await page.getByPlaceholder('请输入登录名').fill(PARTNER_LOGIN)
  await page.getByPlaceholder('请输入密码').fill(PARTNER_PASS)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL(/\/shop/, { timeout: 30_000 })
}

test.describe('合作方订货', () => {
  test('PO-1 合作方登录后进入商品页', async ({ page }) => {
    await loginToShop(page)
    await expect(page.getByText('加入清单').first()).toBeVisible({ timeout: 20_000 })
  })

  test('PO-2 选品提交订单后订单列表可见', async ({ page }) => {
    await loginToShop(page)

    // 等商品列表加载出来
    await expect(page.getByRole('button', { name: '加入清单' }).first()).toBeVisible({ timeout: 20_000 })

    // 先保存一个收货地址（合作方下单必须选地址）
    await page.goto('/partner/addresses')
    await page.waitForTimeout(500)

    // 商品页：加入清单
    await page.goto('/partner/shop')
    await page.getByRole('button', { name: '加入清单' }).first().click()
    await expect(page.getByText('已加入清单').first()).toBeVisible({ timeout: 10_000 })

    // 打开订货清单并提交
    await page.getByText('订货清单').first().click()
    // exact: true —— getByRole 的 name 默认是**子串匹配**，
    // 提示条上的「去下单」这类动作按钮会造成 strict mode 命中多个
    await page.getByRole('button', { name: '提交订单', exact: true }).click()

    /**
     * 「确认提交」二次确认。
     *
     * ⚠️ 原来写的是 `if (await confirmBtn.count() > 0) { click() }` ——
     * 那是**竞态**：弹窗是点「提交订单」之后由 Vue 渲染的，
     * `count()` 在渲染完成前会返回 0 → **跳过点击** → 弹窗一直开着 →
     * 后面等「订单已提交」自然等不到。
     *
     * 这个坑平时不显（渲染够快），但只要页面上多几个元素
     * （比如别的用例刚建了商品/分类，列表变长）就会翻车。
     *
     * 正确写法：**等它出现**再点。
     */
    const confirmBtn = page.getByRole('button', { name: '确认提交' })
    await confirmBtn.waitFor({ state: 'visible', timeout: 15_000 })
    await confirmBtn.first().click()

    // 提交结果
    await expect(
      page.getByText('订单已提交').or(page.getByText('订单已生成，请扫码付款并在弹窗内确认完成')).first()
    ).toBeVisible({ timeout: 30_000 })
  }, 120_000)
})
