import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  if (process.env.E2E_DEBUG) {
    page.on('console', (msg) => console.log('[browser]', msg.type(), msg.text()))
    page.on('response', (res) => {
      if (res.url().includes('/api/orders')) console.log('[orders-response]', res.status(), res.url())
    })
  }
})

function uniqueThaiPhone () {
  return `8${String(Date.now()).slice(-8)}`
}

async function openCheckout (page) {
  await page.goto('/portal/')
  await expect(page.getByText('E2E 测试商品').first()).toBeVisible()
  await page.getByText('E2E 测试商品').first().click()
  await expect(page).toHaveURL(/\/products\/\d+/)
  await page.getByRole('button', { name: '立即购买' }).click()
  await expect(page).toHaveURL(/\/checkout/)
}

async function fillGuestForm (page, phone) {
  await page.getByPlaceholder('请输入联系人姓名').fill('E2E 用户')
  await page.getByPlaceholder('请输入手机号').fill(phone)

  const province = page.locator('.thailand-address-selector select').nth(0)
  const district = page.locator('.thailand-address-selector select').nth(1)
  const subDistrict = page.locator('.thailand-address-selector select').nth(2)

  await expect(province.locator('option').nth(1)).toBeAttached()
  await province.selectOption({ label: 'Bangkok' })
  await expect(district.locator('option').nth(1)).toBeAttached()
  await district.selectOption({ label: 'Pathum Wan' })
  await expect(subDistrict.locator('option').nth(1)).toBeAttached()
  await subDistrict.selectOption({ label: 'Pathum Wan-1' })

  await page.getByPlaceholder(/请输入详细地址/).fill('E2E Test Road 123')
}

async function submitAndExpectProfile (page) {
  await page.getByRole('button', { name: '提交订单' }).click()
  await page.waitForURL(/\/profile\?tab=orders/, { timeout: 30_000 })
  await expect(page.getByText('个人中心').first()).toBeVisible()
}

test.describe('游客下单真实浏览器 E2E', () => {
  test('移动端/桌面端：游客浏览 → 立即购买 → 填地址 → COD 下单 → 订单中心', async ({ page }) => {
    await openCheckout(page)
    await fillGuestForm(page, uniqueThaiPhone())
    await submitAndExpectProfile(page)

    const token = await page.evaluate(() => localStorage.getItem('token'))
    expect(token).toBeTruthy()
    const response = await page.request.get('http://127.0.0.1:3000/api/orders', {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.data.orders.length).toBe(1)
    expect(body.data.orders[0].status).toBe('shipping')
  })

  test('首次提交网络失败 → 重试成功，幂等键保证只创建一单', async ({ page }) => {
    await openCheckout(page)
    await fillGuestForm(page, uniqueThaiPhone())

    let attempts = 0
    await page.route('**/api/orders', async (route) => {
      if (route.request().method() === 'POST') {
        attempts++
        if (attempts === 1) return route.abort('failed')
      }
      await route.continue()
    })

    const submit = page.getByRole('button', { name: '提交订单' })
    await submit.click()
    await expect(page.getByText(/订单提交失败/).first()).toBeVisible()
    await submit.click()
    await page.waitForURL(/\/profile\?tab=orders/, { timeout: 30_000 })
    expect(attempts).toBe(2)

    const token = await page.evaluate(() => localStorage.getItem('token'))
    const response = await page.request.get('http://127.0.0.1:3000/api/orders', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = await response.json()
    expect(body.data.orders.length).toBe(1)
  })
})
