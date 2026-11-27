/**
 * 商品写操作要留操作日志（第 60 轮补）
 * ==========================================
 *
 * ## 为什么补这条
 *
 * 之前只有**批量**改商品那条挂了 `logOperation`：
 *   POST /api/products/bulk → logOperation('bulk_update_product', 'product')
 * 单个商品的建/改/删**没有**留痕 —— 也就是运营最常做的操作反而查不到：
 * "谁把哪个商品下架了 / 改价了 / 删了"在管理端「操作日志」里是空的。
 *
 * 2026-11-27 把生产上一个商品下架时就是这么发现的：
 * 操作确实生效了，但 `operation_logs` 里**一条都没有**。
 *
 * ## 用例
 *
 *   OL-1 改一个商品 → 操作日志里有一条 update_product
 *   OL-2 建一个商品 → 操作日志里有一条 create_product
 *   OL-3 删一个商品 → 操作日志里有一条 delete_product
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

/**
 * 操作日志里的相关记录。
 *
 * ⚠️ **日志是 fire-and-forget 写的**（logOperation 用 setImmediate 落库，
 * 响应先返回、日志后写），所以查一次可能查不到 ——
 * 全量并发跑时尤其容易飘。必须**轮询等它落地**。
 */
async function operationLogs (action) {
  const { OperationLog } = models()
  const rows = await OperationLog.findAll({
    where: { action },
    order: [['created_at', 'DESC']]
  })
  return rows
}

/** 等操作日志落库（最多等 3 秒） */
async function waitForOperationLogs (action, { timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = await operationLogs(action)
    if (rows.length) return rows
    if (Date.now() > deadline) return []
    await new Promise(r => setTimeout(r, 40))
  }
}

describe('商品写操作留痕', () => {
  let adminToken

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    adminToken = TestHelpers.generateAdminToken(admin)
  })

  it('OL-1 改一个商品 → 有 update_product 操作日志', async () => {
    const { Product } = models()
    const product = await Product.create(TestDataFactory.createProduct({
      name: 'OL-1 原名', status: 'active', stock: 10
    }))

    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' })
    expect(res.status).toBe(200)

    const logs = await waitForOperationLogs('update_product')
    expect(logs.length, '改商品必须在操作日志里留痕').toBeGreaterThan(0)
    const row = logs.find(l => String(l.resource_id) === String(product.id))
    expect(row, '操作日志里应有这条商品的记录').toBeTruthy()
    expect(row.resource).toBe('product')
    expect(row.admin_username || row.adminUsername, '记录里要有操作人').toBeTruthy()
  })

  it('OL-2 建一个商品 → 有 create_product 操作日志', async () => {
    const { ProductCategory } = models()
    const cat = await ProductCategory.create({ name: 'OL 分类', sort_order: 91 })

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'OL-2 新商品',
        category_id: cat.id,
        price: 50,
        stock: 3,
        status: 'active'
      })
    expect(res.status).toBe(201)

    const logs = await waitForOperationLogs('create_product')
    expect(logs.length, '建商品必须在操作日志里留痕').toBeGreaterThan(0)
  })

  it('OL-3 删一个商品 → 有 delete_product 操作日志', async () => {
    const { Product } = models()
    const product = await Product.create(TestDataFactory.createProduct({
      name: 'OL-3 待删商品', status: 'active', stock: 1
    }))

    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const logs = await waitForOperationLogs('delete_product')
    expect(logs.length, '删商品必须在操作日志里留痕').toBeGreaterThan(0)
  })
})
