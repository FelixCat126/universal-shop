/**
 * 管理端：合作方 CSV 批量导入 真实浏览器 E2E
 *
 * 合作方开户是成批的 —— 一家经销商一次给十几条信息，
 * 之前只能一个一个在后台填。
 *
 * 用例：
 *   PC-1 选 CSV → 预览 → 看到统计
 *   PC-2 有问题的行 → 逐行列出原因，且不允许导入
 *   PC-3 全部合法 → 确认导入 → 列表里出现新合作方
 *   PC-4 导入的合作方要清理（自己造的数据自己清）
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = 'e2e_admin'
const ADMIN_PASS = 'E2eAdmin#2026'

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.getByPlaceholder('请输入管理员用户名').fill(ADMIN_USER)
  await page.getByPlaceholder('请输入密码').fill(ADMIN_PASS)
  await page.getByRole('button', { name: '立即登录' }).click()
  await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 })
}

/** 在文件选择框里塞一个 CSV（内存文件，不落盘） */
/**
 * ⚠️ 必须限定在**可见的对话框**里：`input[type="file"]` 在整个页面上不止一个
 * （管理端还有其它上传入口），用 `.first()` 会选中**别的**那个 ——
 * 于是本该上传的文件没进去，而对话框里留着上一次的文件，
 * 导进去的是**上一轮的内容**。表现是"导入成功了，但导进来的不是我以为的那份"。
 */
async function attachCsv (page, content) {
  await page.locator('.el-dialog:visible input[type="file"]').setInputFiles({
    name: 'partners.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('﻿' + content, 'utf8')
  })
}

/**
 * 清理：把刚导入的合作方删掉。
 *
 * 走**接口**而不是点界面：新导入的合作方排在列表**最后**（按 id 升序），
 * 可能根本不在第一页 —— 点界面的话还得翻页或搜索。
 */
async function deleteImported (page, request, login) {
  const deleted = await page.evaluate(async (loginToDelete) => {
    const token = localStorage.getItem('admin_token')
    const headers = { Authorization: 'Bearer ' + token }
    const list = await (await fetch('/api/admin/partners', { headers })).json()
    const rows = list.data || []
    const target = rows.find(r => r.login === loginToDelete)
    if (!target) return { ok: false, found: false }
    const res = await fetch(`/api/admin/partners/${target.id}`, { method: 'DELETE', headers })
    return { ok: res.ok, status: res.status, id: target.id }
  }, login)
  expect(deleted.ok, `删除失败：${JSON.stringify(deleted)}`).toBe(true)
}

/** 打开合作方页并打开导入对话框 */
async function openImport (page) {
  await loginAdmin(page)
  await page.goto('/admin/partners')
  await expect(page.getByRole('button', { name: /CSV/ }).first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /CSV 批量导入/ }).click()
  await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 10_000 })
}

test.describe('管理端 合作方 CSV 批量导入', () => {
  test('PC-1 选文件 → 预览 → 看到统计', async ({ page }) => {
    await openImport(page)
    await attachCsv(page, [
      'login,display_name,account_kind,discount_percent',
      'e2e_shop_a,店铺A,dealer,10',
      'e2e_shop_b,店铺B,agent,20'
    ].join('\n'))

    await page.getByRole('button', { name: /^预览$/ }).click()
    await expect(page.locator('.csv-summary')).toContainText(/可导入/, { timeout: 20_000 })
  })

  test('PC-2 有问题的行 → 逐行列出原因，且不能导入', async ({ page }) => {
    await openImport(page)
    await attachCsv(page, [
      'login,display_name,account_kind,discount_percent',
      'e2e_good,好店,dealer,10',
      'e2e_bad!,坏店,dealer,10'
    ].join('\n'))

    await page.getByRole('button', { name: /^预览$/ }).click()
    await expect(page.locator('.csv-error')).toContainText(/登录名/, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: /确认导入/ })).toBeDisabled()
  })

  test('PC-4 跳过错误行模式：坏的行被跳过，好的行照常导入', async ({ page, request }) => {
    await openImport(page)

    const good = `e2e_skip_ok_${Date.now()}`
    await attachCsv(page, [
      'login,display_name,account_kind,discount_percent',
      `${good},好店铺,dealer,10`,
      'e2e_bad_login!,坏店铺,dealer,10'
    ].join('\n'))

    // 切到「跳过错误行」模式
    // ⚠️ Element Plus 的 radio-button 把真正的 <input> 藏起来了（display:none），
    // 直接点 input 会超时 —— 要点可见的标签文字。
    await page.locator('.el-radio-button__inner', { hasText: '跳过错误行' }).click()

    await page.getByRole('button', { name: /^预览$/ }).click()
    await expect(page.locator('.csv-summary')).toContainText(/可导入/, { timeout: 20_000 })

    // 有问题的行被列出来了
    await expect(page.locator('.csv-error')).toContainText(/登录名/, { timeout: 20_000 })

    // 但导入按钮**可用**（skip 模式不因错误行禁用）
    await expect(page.getByRole('button', { name: /确认导入/ })).toBeEnabled()

    await page.getByRole('button', { name: /确认导入/ }).click()
    await expect(page.locator('.el-message--success')).toBeVisible({ timeout: 20_000 })

    // 好行导进去了
    await expect(page.getByText(good).first()).toBeVisible({ timeout: 20_000 })

    // 清理（自己造的数据自己清）
    await deleteImported(page, request, good)
  })

  test('PC-3 全部合法 → 确认导入 → 列表里出现新合作方', async ({ page, request }) => {
    await openImport(page)

    const login = `e2e_shop_${Date.now()}`
    await attachCsv(page, [
      'login,display_name,account_kind,discount_percent',
      `${login},E2E导入店铺,dealer,15`
    ].join('\n'))

    await page.getByRole('button', { name: /^预览$/ }).click()
    await expect(page.locator('.csv-summary')).toContainText(/可导入/, { timeout: 20_000 })

    // 收集所有对 import 接口的响应（预览与真正导入是同一个 URL，靠顺序区分）
    const importResponses = []
    page.on('response', r => {
      if (r.url().includes('/partners/import') && r.request().method() === 'POST') {
        importResponses.push(r)
      }
    })

    await page.getByRole('button', { name: /确认导入/ }).click()

    /**
     * 导入成功后对话框会关闭（失败则保持打开并弹错误提示）——
     * 用"对话框关闭"作为成功信号，比看 toast 可靠：
     * 预览那步也会弹 success toast，它还没消失就会把断言骗过去。
     */
    await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 30_000 })

    // 列表里能找到刚导入的合作方
    // ⚠️ 必须加 :visible —— Element Plus 的固定列会渲染**隐藏的副本表**，
    // `.el-table__row` 同时匹配到主表和那些隐藏副本，`.first()` 可能选中隐藏那份
    // → 断言报 "expected visible, received hidden"，但数据其实是对的。
    const row = page.locator('.el-table__row:visible').filter({ hasText: login }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })

    /**
     * 清理：自己造的数据自己清（见文件头说明）。
     *
     * 这里用**接口**删，不点界面上的删除按钮 ——
     * Element Plus 的固定列（fixed="right"）会渲染**第二张表**，
     * 操作按钮在那张表里，而登录名在主表里：
     * `row.filter({hasText: login}).getByRole('button', {name:'删除'})` 永远找不到
     * （按钮不在那一行里）。按行号去点第二张表又依赖两表的行序一致，更脆。
     * 接口删除是确定性的，顺带也把删除接口本身验了。
     */
    /**
     * 清理：自己造的数据自己清（见文件头说明）。
     *
     * 走**页面内**的 fetch（复用界面已登录的会话），不走 Playwright 的 request：
     * request 客户端对同一个 URL 拿到的响应与页面内 fetch 不一致（实测列表为空），
     * 用页面内的通道至少保证"删的就是页面上看到的那一条"。
     */
    const deleted = await page.evaluate(async (loginToDelete) => {
      const token = localStorage.getItem('admin_token')
      const headers = { Authorization: 'Bearer ' + token }
      const list = await (await fetch('/api/admin/partners', { headers })).json()
      const rows = list.data || []
      const target = rows.find(r => r.login === loginToDelete)
      if (!target) return { ok: false, rows: rows.map(r => r.login) }
      const res = await fetch(`/api/admin/partners/${target.id}`, { method: 'DELETE', headers })
      return { ok: res.ok, status: res.status, id: target.id }
    }, login)
    expect(deleted.ok, `删除失败：${JSON.stringify(deleted)}`).toBe(true)
  })
})
