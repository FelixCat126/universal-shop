/**
 * 管理端导出 CSV 按当前筛选（第 63 轮）
 * =========================================
 *
 * ## 为什么要在浏览器里验一遍
 *
 * 后端已经支持按筛选导出（EX-1），但**管理端按钮有没有把筛选传过去**
 * 只有真点一次才知道 —— 运营的路径是：
 *
 *   点汇总条上的「缺泰文名 17」→ 点「导出 CSV」→ 打开 Excel
 *
 * 拿到的必须是**那 17 条**，不是全部 —— 否则"补内容"这条闭环是断的。
 *
 * ## 口径提醒
 *
 * 比对一律用**管理端口径**（含下架/软删的商品）。
 * 公开接口的 total 只算 active 的，和管理端表格的行数**不是一回事** ——
 * 拿两种口径互相比，早期版本就因此误判过一次。
 *
 * ## 用例
 *
 *   EF-1 导出的是**当前筛选**的结果（不是全部商品）
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const ADMIN_USER = { username: 'e2e_admin', password: 'E2eAdmin#2026' }

async function loginAdmin (page) {
  const res = await page.request.post('/api/admin/login', { data: ADMIN_USER })
  expect(res.status(), '管理员登录失败').toBe(200)
  const token = (await res.json()).data.token
  await page.addInitScript((t) => {
    localStorage.setItem('admin_token', t)
    localStorage.setItem('admin_info', JSON.stringify({ id: 1, username: 'admin', role: 'super_admin' }))
  }, token)
  return token
}

/**
 * 清理自己造的数据。
 *
 * 为什么必须清理：这些用例**造了商品**，而所有 e2e 用例共用同一个库与同一个首页。
 * 首页按 created_at 倒序、每页 8 条 —— 多造几个商品就会把基线商品**挤出第一屏**，
 * `storefrontFirstPaint` 的 SF-1（"首页应保留第一个分类的商品"）就会挂。
 *
 * 所以：造完必须删（软删即可 —— 软删的商品不在公开列表里，首页第一屏就复原了）。
 */
async function cleanupProducts (request, ids, token) {
  for (const id of ids) {
    // 必须带管理员 token —— 匿名删商品是 401，删不掉就等于没清理
    await request.delete(`/api/products/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {})
  }
}

test('EF-1 导出 CSV 按当前筛选（点汇总条 → 导出 → 拿到的是筛出来的那批）', async ({ page, request }) => {
  const adminToken = await loginAdmin(page)
  const createdIds = []

  try {
    // 造一个**缺泰文名**的商品（name_th 不给）
    const cats = await page.request.get('/api/product-categories')
    const cat = ((await cats.json())?.data || [])[0]
    expect(cat, '基线里应有分类').toBeTruthy()

    const created = await page.request.post('/api/products', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'EF-缺泰文名的商品',
        category_id: cat.id,
        price: 66,
        stock: 3,
        status: 'active'
      }
    })
    expect(created.status(), `造商品失败：${created.status()}`).toBe(201)
    createdIds.push((await created.json()).data.id)

    // 管理端口径的全部商品数（含下架/软删）
    const allRes = await page.request.get('/api/products?page=1&pageSize=100', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    const allTotal = (await allRes.json()).data.total

    // 管理端口径的"缺泰文名"数量
    const filteredRes = await page.request.get('/api/products?page=1&pageSize=100&content=missing_name_th', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    const filteredTotal = (await filteredRes.json()).data.total
    expect(filteredTotal, '筛选应确实缩小了范围').toBeLessThan(allTotal)

    // 走界面：点汇总条上的数字 → 列表只剩要补的
    await page.goto('/admin/products')
    const chip = page.locator('.content-summary-bar .content-chip').filter({ hasText: '缺泰文名' })
    await expect(chip, '汇总条上应有「缺泰文名」').toBeVisible({ timeout: 20_000 })
    await chip.click()
    await page.waitForTimeout(1500)

    // 点「导出 CSV」→ 下载的文件应正好是筛出来的那批
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: /导出 CSV|Export CSV/ }).click()
    ])
    const file = await download.path()
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.replace(/^﻿/, '').trim().split(/\r\n/)
    const exportedRows = lines.length - 1

    expect(exportedRows, '导出的行数应等于筛选后的商品数').toBe(filteredTotal)
    expect(exportedRows, '导出的行数应少于全部商品数（说明确实按筛选导出了）').toBeLessThan(allTotal)
  } finally {
    await cleanupProducts(request, createdIds, adminToken)
  }
})
