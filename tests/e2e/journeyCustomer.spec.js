/**
 * 客户端业务流：注册 → 购物车 → 下单（第 50 轮）
 * ================================================
 *
 * ## 为什么要有这条
 *
 * 之前的三条 e2e 各覆盖一段：
 *   - guest-order：游客下单
 *   - portal-checkout：**已有账号**下单
 *   - scrollMemory / storefrontFirstPaint：浏览与交互
 *
 * 缺的是**最常见的那条**：一个**新注册**的客户，从零走完
 * 「注册 → 挑商品 → 购物车 → 结算 → 下单」。
 *
 * 这条路上有一个真实的卡点：**新注册的客户没有地址**，
 * 而结算页必须选地址 → 必须先去建 → 建完还要自己点回结算
 * （第 48 轮把"自动返回"补上了 ✓，这条用例就是它的护栏）。
 *
 * ## 用例
 *   CJ-1 注册 → 加购 → 结算页提示没有地址 → 现场新建 → **自动回到结算页** → 下单 → 状态"备货中"
 *   CJ-2 注册 → 加购 → 结算 → 新建地址 → 下单 → 进订单详情页看到商品与金额
 */
import { test, expect } from '@playwright/test'
import { acceptConsent } from './helpers/consent.js'

const PASSWORD = 'Journey#2026'
const NICKNAME = '流程测试客户'

/**
 * 生成一个**每次运行都不同**的手机号。
 *
 * 泰国号段 81 + 8 位数字；这里取「时间戳后 6 位 + 用例序号」，
 * 保证：同一轮内两条用例不撞、不同轮次之间也不撞。
 */
function uniquePhone (seq) {
  const stamp = Date.now().toString().slice(-6)
  return `81${String(seq)}${stamp}`.slice(0, 11)
}

/**
 * 每个用例用**不同的手机号** —— 同一个手机号注册第二次会被"该手机号已被注册"挡住。
 *
 * ⚠️ 而且手机号必须是**每次运行都不同**的：
 * Playwright 的两个 project（desktop-chrome / mobile-chrome）**共用同一个 E2E 服务**
 * （同一份数据库），两个 project 各跑一遍 → 固定手机号第二遍必然撞「已被注册」。
 * 所以这里用「时间戳尾号 + 用例序号」生成，既不撞号也不会被枚举。
 */
async function register (page, phone) {
  await page.goto('/portal/register')
  await page.getByPlaceholder(/昵称|Nickname/i).fill(NICKNAME)
  await page.getByPlaceholder(/手机号|Phone/i).fill(phone)
  await page.getByPlaceholder(/^请输入.*密码$|Password/i).first().fill(PASSWORD)
  await page.getByPlaceholder(/再次输入密码|Confirm/i).fill(PASSWORD)
  // 第 54 轮：注册页新增「条款 + 年龄」确认（服务端强制，不勾就 400）
  await acceptConsent(page)
  await page.getByRole('button', { name: /创建|注册|Create|Register/i }).click()
  await page.waitForURL(/\/portal\/?(\?.*)?$/, { timeout: 30_000 })
  return phone
}

/** 挑一个商品加购（首页 → 商品详情 → 加入购物车） */
async function addToCart (page) {
  await page.goto('/portal/')
  await expect(page.getByText('E2E 测试商品').first()).toBeVisible({ timeout: 20_000 })
  await page.getByText('E2E 测试商品').first().click()
  await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 20_000 })
  await page.getByRole('button', { name: /加入购物车|Add to cart/i }).filter({ visible: true }).first().click()
  await expect(page.getByText(/已加入|加入成功|Added/i).first()).toBeVisible({ timeout: 15_000 })
}

/** 结算页：没有地址就现场建一个（并验证会自动回到结算页） */
async function ensureAddressAtCheckout (page) {
  await page.goto('/portal/cart')
  await page.getByRole('button', { name: /去结算|Checkout/i }).first().click()
  await expect(page).toHaveURL(/\/checkout/, { timeout: 20_000 })

  const addAddress = page.getByRole('button', { name: /添加.*地址|Add address/i }).first()
  if (await addAddress.count()) {
    // 新注册的客户没有地址 → 结算页要明确提示并给入口
    await expect(page.getByText(/还没有|暂无地址|请先添加地址|noAddresses/i).first())
      .toBeVisible({ timeout: 20_000 })
    await addAddress.click()
    await page.waitForURL(/\/profile\?tab=addresses/, { timeout: 20_000 })

    await page.getByPlaceholder(/联系人|收货人|Contact name/i).fill('流程测试收货人')
    await page.getByPlaceholder(/手机号|Phone/i).first().fill('812345678')
    await page.getByPlaceholder(/详细地址|Detail address/i).fill('曼谷 测试路 88 号')

    /**
     * 泰国三级地址：省 → 市区 → 子区。
     *
     * ⚠️ 模态框里的 select 顺序是 **[国家, 省, 市区, 子区, 地址类型]** ——
     * 第一个是"国家/区号"选择器（已默认 +66），
     * 所以三级要从**第 1 个**开始选；从第 0 个开始会选成 国/省/市区，
     * 子区没选 → 邮编填不上 → 保存报"省市区必填"。
     *
     * ⚠️ 下级选项是**异步加载**的：选完省要等市区的下拉有选项，选完市区要等子区的下拉有选项。
     */
    const selects = page.locator('div.fixed.inset-0 select')
    for (const idx of [1, 2, 3]) {
      const sel = selects.nth(idx)
      if (!(await sel.count())) break
      // 等这一级的选项加载出来（超过占位项）
      await sel.locator('option').nth(1).waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
      const options = await sel.locator('option').count()
      if (options > 1) {
        await sel.selectOption({ index: 1 }).catch(() => {})
      }
    }

    // 邮编是**选中子区后异步回填**的 → 等它填上再提交，否则保存报"省市区必填"
    const postal = page.getByPlaceholder(/选择子区后自动填入|postal/i)
    if (await postal.count()) {
      await postal.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      await page.waitForFunction(() => {
        const el = document.querySelector('input[placeholder*="邮编"], input[placeholder*="自动填入"]')
        return !el || (el.value && el.value.length > 0)
      }, { timeout: 10_000 }).catch(() => {})
    }

    // 提交表单（按钮文案是"添加"，不是"保存"）
    //
    // ⚠️ 移动端（Pixel 5 视口）这个弹窗**比视口还高**，「添加」按钮在屏幕最底下。
    // 直接点会被上方元素拦截（"intercepts pointer events"）→
    // 先把按钮滚进视口再点。
    const submitBtn = page.locator('div.fixed.inset-0').getByRole('button', { name: /添加|保存|Add|Save/i }).last()
    await submitBtn.scrollIntoViewIfNeeded()
    await submitBtn.click()
    // 弹窗关闭 = 保存成功（提示文案各语言不同，不断言提示文案，断言语义）
    await expect(page.locator('div.fixed.inset-0')).toHaveCount(0, { timeout: 20_000 })

    // **自动回到结算页**（第 48 轮补的：结算页的文案一直承诺"添加地址后将自动返回结算页面"）
    await page.waitForURL(/\/checkout/, { timeout: 20_000 })
    await expect(page.getByText('流程测试收货人').first()).toBeVisible({ timeout: 20_000 })
  }
}

test.describe('客户端业务流', () => {
  // 这条流程本身就很长（注册 → 加购 → 三级地址 → 回结算 → 下单），默认 90s 不够
  test.setTimeout(180_000)
  test('CJ-1 注册 → 加购 → 新建地址 → 自动回结算 → 下单 → 状态备货中', async ({ page }) => {
    await register(page, uniquePhone(1))
    await addToCart(page)
    await ensureAddressAtCheckout(page)

    // 第 54 轮：结算页新增「条款 + 年龄」确认（服务端强制）
    await acceptConsent(page)
    await page.getByRole('button', { name: /提交订单|Submit|Place order/i }).first().click()
    await page.waitForURL(/\/profile\?tab=orders/, { timeout: 40_000 })

    // 订单出现在「我的订单」（列表显示的是单号/金额/状态，不显示商品名）
    await expect(page.getByText(/订单号[:：]\s*ORD/i).first()).toBeVisible({ timeout: 20_000 })
    // COD 单下单即"备货中/送货中"
    await expect(page.getByText(/备货中|送货中|Shipping|กำลังจัดส่ง/i).first())
      .toBeVisible({ timeout: 20_000 })
  })

  test('CJ-2 下单后进订单详情，能看到商品与金额', async ({ page }) => {
    await register(page, uniquePhone(2))
    await addToCart(page)
    await ensureAddressAtCheckout(page)

    // 第 54 轮：结算页新增「条款 + 年龄」确认（服务端强制）
    await acceptConsent(page)
    await page.getByRole('button', { name: /提交订单|Submit|Place order/i }).first().click()
    await page.waitForURL(/\/profile\?tab=orders/, { timeout: 40_000 })

    // 进详情页
    await page.getByRole('button', { name: /查看详情|详情|View details/i }).first().click()
    await page.waitForURL(/\/orders\/\d+/, { timeout: 20_000 })
    await expect(page.getByText('E2E 测试商品').first()).toBeVisible({ timeout: 20_000 })
    // 详情页要能看到金额（不是空白）
    await expect(page.getByText(/订单总计|Total/i).first()).toBeVisible({ timeout: 20_000 })
    // 这几轮加的入口也要在（申请售后 / 刷新 / 取消订单）
    await expect(page.getByRole('button', { name: /申请售后|Request after-sales/i }).first())
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /刷新|Refresh/i }).first())
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /取消订单|Cancel order/i }).first())
      .toBeVisible({ timeout: 20_000 })
  })
})
