/**
 * 内容完整度汇总（第 62 轮）
 * ============================
 *
 * ## 为什么要它
 *
 * 第 54 轮给每行挂了「缺泰文名 / 缺描述」两个灰标签。生产上
 * **18 个商品全部缺泰文名、16 个缺描述** → 每行都挂 → 标签从"提示"变成**噪音**，
 * 真正要找的那一行反而被淹没。
 *
 * 改成"表格上方一行汇总 + 点数字直接筛"：第一眼看到"还差多少"，点一下就筛出来。
 *
 * ## 用例
 *
 *   CS-1 汇总数正确（总数 / 缺泰文名 / 缺描述）
 *   CS-2 汇总是**全量口径**（不受分页/筛选影响）
 *   CS-3 软删商品不计入
 *   CS-4 **只有管理端**能拿（匿名 → 401）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

const summary = (token) =>
  request(app).get('/api/products/content-summary')
    .set('Authorization', `Bearer ${token}`)

describe('内容完整度汇总', () => {
  let token

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    token = TestHelpers.generateAdminToken(admin)
  })

  it('CS-1 汇总数正确', async () => {
    const { Product } = models()
    // 完整的
    await Product.create(TestDataFactory.createProduct({ name: 'CS-1 完整', name_th: 'ครบ', description: '有描述' }))
    // 缺泰文名
    await Product.create(TestDataFactory.createProduct({ name: 'CS-1 缺泰文名', name_th: null, description: '有描述' }))
    // 缺描述
    await Product.create(TestDataFactory.createProduct({ name: 'CS-1 缺描述', name_th: 'มีชื่อ', description: '' }))
    // 泰文名是空串（也算缺）
    await Product.create(TestDataFactory.createProduct({ name: 'CS-1 泰文名空串', name_th: '', description: '有描述' }))

    const res = await summary(token)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.total).toBe(4)
    expect(res.body.data.missingNameTh, '缺泰文名（含空串）应算 2 个').toBe(2)
    expect(res.body.data.missingDescription, '缺描述应算 1 个').toBe(1)
  })

  it('CS-2 汇总是全量口径（不受分页/筛选影响）', async () => {
    const { Product } = models()
    for (let i = 0; i < 5; i++) {
      await Product.create(TestDataFactory.createProduct({ name: `CS-2 商品 ${i}`, name_th: null, description: '有描述' }))
    }

    const res = await summary(token)
    expect(res.status).toBe(200)
    expect(res.body.data.total, '汇总不能只数当前页').toBe(5)
    expect(res.body.data.missingNameTh).toBe(5)
  })

  it('CS-3 软删商品不计入', async () => {
    const { Product } = models()
    const p = await Product.create(TestDataFactory.createProduct({ name: 'CS-3 已删', name_th: null, description: '' }))
    await p.destroy() // 软删

    const res = await summary(token)
    expect(res.status).toBe(200)
    expect(res.body.data.total, '软删的商品不该计入汇总').toBe(0)
  })

  it('CS-4 只有管理端能拿（匿名 → 401）', async () => {
    const res = await request(app).get('/api/products/content-summary')
    expect(res.status).toBe(401)
  })
})
