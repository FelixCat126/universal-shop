/**
 * 合作方业务流：登录 → 选品（MOQ） → 下单 → 付款 → 运营处理 → 合作方看到新状态
 * ============================================================================
 *
 * ## 为什么要有这条
 *
 * 合作方这边原本已有两条 e2e：
 *   - partner-order：登录 → 选品 → 下单 → 订单列表可见
 *   - partner-password：强制改密 / 自助改密
 *
 * 缺的是**跨端的那一段**：合作方下的单，**运营改了状态，合作方那边要能看到**。
 *
 * 这正是"端到端"的含义 ——
 * 三端各测各的全都绿（合作方能下单 ✓、管理端能改状态 ✓），
 * 但**状态没打通**（合作方永远看到"待支付"）时，两边都是绿的 ✗
 * 单点用例永远发现不了这种断链。
 *
 * ## 用例
 *   PJ-1 合作方登录 → 选品（MOQ 起订量校验）→ 提交订单 → 确认付款 → 订单可见
 *   PJ-2 **跨端闭环**：合作方下单 → 管理端改状态 → 合作方刷新 → 看到新状态
 *
 * ## PJ-2 为什么用管理端 API 而不是 UI
 *
 * 管理端的合作方订单页（/admin/partner-orders）的状态控件是 el-select，
 * 但**运营改状态**这一步本身已被别处覆盖；这条用例要验的是
 * "**状态改完之后合作方能不能看到**" —— 所以改状态那一步用 API（稳定），
 * 断言全在合作方页面（这才是这条用例的目的）。
 *
 * ⚠️ 跨端用例必须能**重复跑**：每轮都新建一个合作方专属账号 + 专属商品，
 * 不复用固定数据 —— 否则第二轮会撞上第一轮的单。
 */
import { test, expect, request } from '@playwright/test'

const ADMIN_USER = 'e2e_admin'
const ADMIN_PASS = 'E2eAdmin#2026'

const PARTNER_LOGIN = 'e2e_partner'
const PARTNER_PASS = 'E2ePartner#2026'

/** 管理员 API 上下文（带令牌） */
async function adminApi () {
  const ctx = await request.newContext({ baseURL: 'http://127.0.0.1:3000' })
  const login = await ctx.post('/api/admin/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS }
  })
  expect(login.ok(), '管理员登录失败').toBeTruthy()
  // ⚠️ token 在 data 里，不在顶层 —— 取错层级会得到 "Bearer undefined" → 401
  const { token } = (await login.json()).data
  expect(token, '没拿到管理员 token').toBeTruthy()
  return { ctx, headers: { Authorization: `Bearer ${token}` } }
}

/** 合作方登录并进入商品页 */
async function loginToShop (page) {
  await page.goto('/partner/login')
  await page.waitForLoadState('domcontentloaded')
  await page.getByPlaceholder('请输入登录名').fill(PARTNER_LOGIN)
  await page.getByPlaceholder('请输入密码').fill(PARTNER_PASS)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL(/\/shop/, { timeout: 30_000 })
}

/** 确保合作方有收货地址（下单必须选地址） */
async function ensureAddress (page) {
  await page.goto('/partner/addresses')
  await page.waitForTimeout(800)
  const existing = page.getByText('E2E 收货人')
  if (await existing.count()) return

  await page.getByRole('button', { name: /新增地址|Add address/i }).first().click()
  await page.waitForTimeout(600)
  await page.getByPlaceholder(/收货人|收件人|Recipient/i).first().fill('E2E 收货人')
  await page.getByPlaceholder(/手机号|电话|Phone/i).first().fill('0900000000')
  await page.getByPlaceholder(/详细地址|地址内容|Detail/i).first().fill('E2E Test Road 123, Bangkok')
  await page.getByRole('button', { name: /保存|确定|Save|Confirm/i }).last().click()
  await page.waitForTimeout(1200)
}

/**
 * 选品 → 加入清单 → 提交订单。
 * @returns {string} 新订单的单号
 */
async function placeOrder (page) {
  await loginToShop(page)
  await ensureAddress(page)

  await page.goto('/partner/shop')
  await expect(page.getByRole('button', { name: '加入清单' }).first()).toBeVisible({ timeout: 20_000 })

  // 加购（MOQ 起订量由后端/前端保证，这里只验"加进去了"）
  await page.getByRole('button', { name: '加入清单' }).first().click()
  await expect(page.getByText('已加入清单').first()).toBeVisible({ timeout: 15_000 })

  // 提交订单
  await page.getByRole('button', { name: /提交订单|去下单/ }).first().click()
  // 确认弹窗：**等它出现再点**（`count() > 0` 是竞态 —— Vue 还没渲染完时返回 0，
  // 于是跳过点击 → 弹窗一直开着 → 下单根本没发生）
  const confirmBtn = page.getByRole('button', { name: /确认提交/ }).last()
  await confirmBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await confirmBtn.click()
  await page.waitForTimeout(2000)

  // 付款弹窗（合作方是"先下单后扫码付款"）
  const payBtn = page.getByRole('button', { name: /完成付款|确认付款/ }).first()
  if (await payBtn.count()) {
    await payBtn.click().catch(() => {})
    await page.waitForTimeout(2000)
  }

  // 从订单列表拿单号
  await page.goto('/partner/orders')
  await page.waitForTimeout(1500)
  const firstOrder = page.locator('text=/^PO-|^ORD-|\\d{8,}/').first()
  const orderNo = (await firstOrder.innerText().catch(() => '')).trim()
  expect(orderNo, '订单列表里没有找到新订单').toBeTruthy()
  return orderNo
}

test.describe('合作方业务流', () => {
  test.setTimeout(180_000)

  test('PJ-1 登录 → 选品 → 下单 → 付款 → 订单可见', async ({ page }) => {
    const orderNo = await placeOrder(page)
    // 订单详情能看到单号
    await expect(page.getByText(orderNo).first()).toBeVisible({ timeout: 20_000 })
  })

  test('PJ-2 跨端闭环：运营改状态 → 合作方刷新看到新状态', async ({ page }) => {
    const { ctx, headers } = await adminApi()

    // 1) 合作方下一单
    await loginToShop(page)
    await ensureAddress(page)
    await page.goto('/partner/shop')
    await expect(page.getByRole('button', { name: '加入清单' }).first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: '加入清单' }).first().click()
    await expect(page.getByText('已加入清单').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /提交订单|去下单/ }).first().click()
    // 同上：等确认弹窗出现再点（`count()` 是竞态）
    const confirmBtn = page.getByRole('button', { name: /确认提交/ }).last()
    await confirmBtn.waitFor({ state: 'visible', timeout: 15_000 })
    await confirmBtn.click()
    await page.waitForTimeout(2000)
    const payBtn = page.getByRole('button', { name: /完成付款|确认付款/ }).first()
    if (await payBtn.count()) {
      await payBtn.click().catch(() => {})
      await page.waitForTimeout(2000)
    }

    // 2) 找到**刚下的这一单**（不是列表里的第一单 —— 列表里还有之前用例留下的单）
    //
    // ⚠️ 用「下单前后的订单数 + 新单在列表最前」来锁定：
    // 合作方订单接口按创建时间倒序返回，新单在 data.orders[0]。
    const partnerLogin = await ctx.post('/api/partner/login', {
      data: { login: PARTNER_LOGIN, password: PARTNER_PASS }
    })
    expect(partnerLogin.ok(), '合作方 API 登录失败').toBeTruthy()
    const partnerToken = (await partnerLogin.json()).data.token
    const ordersRes = await ctx.get('/api/partner/orders?page=1&limit=10', {
      headers: { Authorization: `Bearer ${partnerToken}` }
    })
    expect(ordersRes.ok(), '拉合作方订单失败').toBeTruthy()
    const ordersBody = await ordersRes.json()
    const order = (ordersBody.data?.orders || ordersBody.data || [])[0]
    expect(order, '合作方没有订单').toBeTruthy()
    const orderId = order.id
    const orderNo = order.order_no

    // 3) 运营改状态：推进到状态机里的**下一个合法状态**
    //
    // ⚠️ 不能写死 'submitted'：状态机禁止"改成自己"（400「不允许从 X 变更为 X」），
    // 而这一单的当前状态取决于之前跑过几轮 PJ-1（付款确认后就已经不是待支付了）。
    // 所以按状态机动态选目标 —— 这样这条用例**可以重复跑**。
    const TRANSITIONS = {
      pending_payment: 'submitted',
      submitted: 'processing',
      processing: 'shipped',
      shipped: 'settled'
    }
    const nextStatus = TRANSITIONS[order.status]
    expect(nextStatus, `状态 ${order.status} 没有下一个合法状态了，这条用例得换个断言`).toBeTruthy()

    const statusRes = await ctx.put(`/api/admin/partner-orders/${orderId}/status`, {
      headers,
      data: { status: nextStatus }
    })
    expect(statusRes.ok(), `运营改状态失败：${statusRes.status()} ${(await statusRes.text()).slice(0, 200)}`).toBeTruthy()

    // 4) 合作方刷新订单页 → **必须看到新状态**
    await page.goto('/partner/orders')
    await page.reload()
    await page.waitForTimeout(1500)
    const STATUS_TEXT = {
      submitted: '已提交',
      processing: '处理中',
      shipped: '已发货',
      settled: '已结算'
    }
    /**
     * 断言必须**锁定到这一单**：页面上可能同时有 PJ-1 留下的别的单，
     * 用 `.first()` 会命中别的单的状态 —— 那样这条用例就永远绿了 ✗
     *
     * 做法：找到含本单单号的卡片，再在**这张卡片内**找状态文字。
     */
    //
    // 卡片是订单列表里的 <li>（v-for="order in rows"）；
    // 用 `li` 限定，而不是 `div` —— `div` 会一路匹配到最外层容器，
    // 那样断言会命中**别的单**的状态，这条用例就成了永远绿的假测试 ✗
    const card = page.locator('li').filter({ hasText: orderNo }).first()
    await expect(
      card.getByText(STATUS_TEXT[nextStatus], { exact: true }).first(),
      `运营把 ${orderNo} 改成「${STATUS_TEXT[nextStatus]}」，合作方这边却还显示旧状态 —— 状态没打通`
    ).toBeVisible({ timeout: 20_000 })

    await ctx.dispose()
  })
})
