/**
 * 商品 CSV 导出与列表同一口径（第 63 轮）
 * ============================================
 *
 * ## 问题
 *
 * 管理端商品列表能按各种条件筛选（分类 / 库存状态 / 上架状态 / 内容完整度），
 * 但**导出 CSV 完全不看筛选** —— 永远导出**全部**商品。
 *
 * 后果（第 62 轮做汇总条时暴露的）：
 * 运营点汇总条上的「缺泰文名 17」→ 列表只剩要补的 → 点导出 → 拿到的却是**全部 18 条**
 * → 他得自己删行才能当"待补清单"用。
 *
 * ## 这一轮要保证的
 *
 *   EX-1 导出**按筛选条件**（与列表同一套口径）
 *   EX-2 不带筛选 → 导出全部（行为不变）
 *   EX-3 **闭环**：导出待补清单 → 在 CSV 里补上泰文名 → 导回来 → 商品真的被更新了
 *   EX-4 导出不需要管理员以外的权限（仅管理端）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

const exportCsv = (token, params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return request(app)
    .get(`/api/products/export.csv${qs ? '?' + qs : ''}`)
    .set('Authorization', `Bearer ${token}`)
}

/** 解析导出的 CSV（简单：按行切，取第一列 id） */
function parseIds (csvText) {
  const lines = csvText.replace(/^﻿/, '').trim().split(/\r\n/)
  if (lines.length <= 1) return []
  return lines.slice(1)
    .map(l => l.split(',')[0])
    .map(v => Number(v))
    .filter(n => Number.isInteger(n))
}

describe('商品导出与列表同一口径', () => {
  let token

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    token = TestHelpers.generateAdminToken(admin)
  })

  it('EX-1 导出按筛选条件（内容完整度 / 分类 / 关键词）', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'EX-1 分类', sort_order: 93 })
    const other = await ProductCategory.create({ name: 'EX-1 其它分类', sort_order: 92 })

    const noTh = await Product.create(TestDataFactory.createProduct({
      name: 'EX-1 缺泰文名', name_th: null, description: '有描述', category_id: cat.id, status: 'active'
    }))
    const ok = await Product.create(TestDataFactory.createProduct({
      name: 'EX-1 完整', name_th: 'ครบ', description: '有描述', category_id: cat.id, status: 'active'
    }))
    const elsewhere = await Product.create(TestDataFactory.createProduct({
      name: 'EX-1 别的分类', name_th: null, description: '有描述', category_id: other.id, status: 'active'
    }))

    // 内容完整度筛选
    let res = await exportCsv(token, { content: 'missing_name_th' })
    expect(res.status).toBe(200)
    let ids = parseIds(res.text)
    expect(ids).toContain(noTh.id)
    expect(ids).not.toContain(ok.id)
    expect(ids).toContain(elsewhere.id)

    // 分类筛选
    res = await exportCsv(token, { category_id: String(cat.id) })
    ids = parseIds(res.text)
    expect(ids).toContain(noTh.id)
    expect(ids).toContain(ok.id)
    expect(ids).not.toContain(elsewhere.id)

    // 关键词筛选
    res = await exportCsv(token, { name: '别的分类' })
    ids = parseIds(res.text)
    expect(ids).toEqual([elsewhere.id])
  })

  it('EX-2 不带筛选 → 导出全部', async () => {
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({ name: 'EX-2 甲', status: 'active' }))
    await Product.create(TestDataFactory.createProduct({ name: 'EX-2 乙', status: 'active' }))

    const res = await exportCsv(token)
    expect(res.status).toBe(200)
    expect(parseIds(res.text).length).toBe(2)
  })

  it('EX-3 闭环：导出待补清单 → 补上泰文名 → 导回来 → 商品被更新', async () => {
    const { Product } = models()
    const p = await Product.create(TestDataFactory.createProduct({
      name: 'EX-3 待补', name_th: null, description: '待补描述', status: 'active'
    }))

    // ① 导出"缺泰文名"的清单
    const exported = await exportCsv(token, { content: 'missing_name_th' })
    expect(exported.status).toBe(200)
    const ids = parseIds(exported.text)
    expect(ids).toContain(p.id)

    // ② 在 CSV 里补上泰文名（模拟运营在 Excel 里改完）
    const csvText = exported.text
      .replace(/^﻿/, '')
      .trim()
      .split(/\r\n/)
    const header = csvText[0].split(',')
    const thIdx = header.indexOf('name_th')
    const idIdx = header.indexOf('id')
    expect(thIdx, 'CSV 必须有 name_th 列（不然运营没地方填泰文名）').toBeGreaterThan(-1)
    const patched = csvText.map((line, i) => {
      if (i === 0) return line
      const cells = line.split(',')
      if (Number(cells[idIdx]) === p.id) cells[thIdx] = 'ชื่อไทยใหม่'
      return cells.join(',')
    }).join('\r\n')

    // ③ 导回来（带 id 的行 = 更新）
    const imported = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${token}`)
      .field('dry_run', 'false')
      .attach('file', Buffer.from('﻿' + patched, 'utf8'), 'products.csv')
    expect(imported.status, `导入失败：${imported.status} ${String(imported.text || '').slice(0, 200)}`).toBe(200)

    const after = await Product.findByPk(p.id, { paranoid: false })
    expect(after.name_th, '导回来后泰文名应该被更新').toBe('ชื่อไทยใหม่')
  })

  it('EX-4 导出需要管理端权限（匿名 → 401）', async () => {
    const res = await request(app).get('/api/products/export.csv')
    expect(res.status).toBe(401)
  })
})
