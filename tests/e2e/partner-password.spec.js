/**
 * 合作方：自助改密 + 强制改密
 *
 * 之前合作方**完全没有改密途径**（门户没有页面、接口也没有），
 * CSV 批量导入的账号拿到的是运营线下告知的随机初始密码 —— 那个密码会一直有效。
 *
 * PW-1 强制改密：登录后被挡在改密页，改完才能进订货
 * PW-2 普通账号：导航里有"改密码"入口，改密成功（改完再改回原密码，保证可重复跑）
 *
 * ⚠️ 这两个用例会**真的改密码**，而且 Playwright 的两个 project（桌面/移动）
 * 共用同一个 E2E 服务 → 同一份数据会被改两次。
 * 所以每个用例开头都通过**管理端 API** 把密码重置回已知值，
 * 结尾再把密码改回去 —— 跑多少遍结果都一样。
 */
import { test, expect, request } from '@playwright/test'

const ADMIN_USER = 'e2e_admin'
const ADMIN_PASS = 'E2eAdmin#2026'

const TEMP_LOGIN = 'e2e_partner_temp'
const TEMP_PASS = 'E2eTemp#2026'
const TEMP_NEW_PASS = 'E2eChanged#2026'

const PLAIN_LOGIN = 'e2e_partner_pwd'
const PLAIN_PASS = 'E2ePwd#2026'
const PLAIN_NEW_PASS = 'E2ePlainNew#2026'

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
  const headers = { Authorization: `Bearer ${token}` }

  /** 把某个合作方的密码重置成指定值（管理端重置会同时置上"必须改密"标记） */
  const resetPassword = async (partnerLogin, password) => {
    const list = await ctx.get('/api/admin/partners', { headers })
    expect(list.ok(), `拉合作方列表失败：${list.status()} ${(await list.text()).slice(0, 200)}`).toBeTruthy()
    const partner = (await list.json()).data.find(p => p.login === partnerLogin)
    expect(partner, `找不到合作方 ${partnerLogin}`).toBeTruthy()
    const res = await ctx.put(`/api/admin/partners/${partner.id}/password`, {
      headers,
      data: { password }
    })
    expect(res.ok(), `重置 ${partnerLogin} 密码失败`).toBeTruthy()
  }

  return { ctx, resetPassword }
}

/** 浏览器登录 */
async function login (page, loginName, password) {
  await page.goto('/partner/login')
  await page.getByPlaceholder('请输入登录名').fill(loginName)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
}

/** 填改密表单并提交 */
async function changePassword (page, current, next) {
  await page.locator('#pw-current').fill(current)
  await page.locator('#pw-new').fill(next)
  await page.locator('#pw-confirm').fill(next)
  await page.getByRole('button', { name: /保存新密码/ }).click()
}

test.describe('合作方改密', () => {
  test('PW-1 强制改密：登录后被挡在改密页，改完才能进订货', async ({ page }) => {
    const { ctx, resetPassword } = await adminApi()
    // 复位：管理端重置密码 = 初始口令，必须改密
    await resetPassword(TEMP_LOGIN, TEMP_PASS)

    await login(page, TEMP_LOGIN, TEMP_PASS)

    // 被强制带到改密页
    await page.waitForURL(/\/partner\/password/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible({ timeout: 15_000 })
    // 强制改密提示（用 role=alert 精确定位 —— 页面里还有别的含"初始密码"的文字）
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })

    // 改密
    await changePassword(page, TEMP_PASS, TEMP_NEW_PASS)
    await expect(page.getByText('密码已修改').first()).toBeVisible({ timeout: 15_000 })

    // 改完进入订货页
    await page.waitForURL(/\/partner\/shop/, { timeout: 30_000 })
    await expect(page.getByText('加入清单').first()).toBeVisible({ timeout: 20_000 })

    // 新密码能登录
    // ⚠️ 先清掉本地凭据 —— 还处于登录状态时访问 /partner/login 会被守卫弹回订货页
    await page.evaluate(() => localStorage.clear())
    await login(page, TEMP_LOGIN, TEMP_NEW_PASS)
    await page.waitForURL(/\/partner\/shop/, { timeout: 30_000 })

    // 复位：改回原始密码（否则下一个 project 跑就会失败）
    await resetPassword(TEMP_LOGIN, TEMP_PASS)
    await ctx.dispose()
  })

  test('PW-2 普通账号：导航里有"改密码"入口，改密成功', async ({ page }) => {
    const { ctx, resetPassword } = await adminApi()
    await resetPassword(PLAIN_LOGIN, PLAIN_PASS)

    // 复位后是"必须改密"状态 —— 先改一次，改完就是普通账号了
    await login(page, PLAIN_LOGIN, PLAIN_PASS)
    await page.waitForURL(/\/partner\/password/, { timeout: 30_000 })
    await changePassword(page, PLAIN_PASS, PLAIN_NEW_PASS)
    await expect(page.getByText('密码已修改').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForURL(/\/partner\/shop/, { timeout: 30_000 })

    // 导航入口
    await page.goto('/partner/password')
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible({ timeout: 15_000 })
    // 已经改过密码 → 不再显示强制改密提示
    await expect(page.getByRole('alert')).toHaveCount(0)

    // 两次输入不一致 → 提示
    await page.locator('#pw-current').fill(PLAIN_NEW_PASS)
    await page.locator('#pw-new').fill('E2eOther#2026')
    await page.locator('#pw-confirm').fill('E2eMismatch#2026')
    await page.getByRole('button', { name: /保存新密码/ }).click()
    await expect(page.getByText(/不一致/)).toBeVisible({ timeout: 10_000 })

    // 正确改密
    await page.locator('#pw-confirm').fill('E2eOther#2026')
    await page.getByRole('button', { name: /保存新密码/ }).click()
    await expect(page.getByText('密码已修改').first()).toBeVisible({ timeout: 15_000 })

    // 改密后会话仍然有效（token 已换成新的）
    await page.goto('/partner/orders')
    await expect(page.getByRole('heading', { name: '我的订单' }).first()).toBeVisible({ timeout: 20_000 })

    // 复位：改回原始密码（保证可重复跑）
    await resetPassword(PLAIN_LOGIN, PLAIN_PASS)
    await ctx.dispose()
  })
})
