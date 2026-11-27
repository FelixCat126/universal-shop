/**
 * 商品"内容完整度"筛选（第 60 轮 · 操作便利性）
 * ================================================
 *
 * ## 为什么要有这个筛选
 *
 * 第 54 轮给每行加了「缺泰文名 / 缺描述」标记，运营一眼能看出商品缺什么。
 * 但**标记只是提示** —— 运营真正要干的是"把缺内容的商品补齐"，
 * 而生产上 18 个商品**全部**缺泰文名、17 个缺描述。
 *
 * 没有筛选时，运营只能一页一页（20 条）翻着看，
 * 而且"哪些还缺"要靠眼睛一行行扫 —— 补到一半就不知道还剩几个。
 *
 * 所以筛选必须放在**服务端**：前端过滤只能筛当前这一页。
 *
 * ## 用例
 *
 *   CF-1 缺泰文名的商品能被筛出来（且不包含完整的商品）
 *   CF-2 缺描述的商品能被筛出来
 *   CF-3 公开接口**不接受**这个参数（普通用户不能用来翻数据）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

describe('商品内容完整度筛选', () => {
  let adminToken

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    adminToken = TestHelpers.generateAdminToken(admin)
  })

  it('CF-1 缺泰文名的商品能被筛出来（且不含完整商品）', async () => {
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-1 缺泰文名', name_th: null, description: '有描述', status: 'active'
    }))
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-1 有泰文名', name_th: 'มีชื่อไทย', description: '有描述', status: 'active'
    }))
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-1 泰文名是空串', name_th: '', description: '有描述', status: 'active'
    }))

    const res = await request(app)
      .get('/api/products?content=missing_name_th&page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const names = res.body.data.products.map(p => p.name).sort()
    expect(names, '缺泰文名的（含空串）应被筛出来，完整的不能出现').toEqual([
      'CF-1 泰文名是空串',
      'CF-1 缺泰文名'
    ])
  })

  it('CF-2 缺描述的商品能被筛出来', async () => {
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-2 缺描述', description: null, status: 'active'
    }))
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-2 有描述', description: '写好了', status: 'active'
    }))

    const res = await request(app)
      .get('/api/products?content=missing_description&page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const names = res.body.data.products.map(p => p.name)
    expect(names).toContain('CF-2 缺描述')
    expect(names).not.toContain('CF-2 有描述')
  })

  it('CF-3 公开接口不接受这个筛选参数', async () => {
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-3 有泰文名', name_th: 'มีชื่อไทย', description: '有描述', status: 'active'
    }))
    await Product.create(TestDataFactory.createProduct({
      name: 'CF-3 缺泰文名', name_th: null, description: '有描述', status: 'active'
    }))

    const res = await request(app).get('/api/products?content=missing_name_th&page=1&pageSize=20')
    expect(res.status).toBe(200)
    const names = res.body.data.products.map(p => p.name)
    expect(names.length, '公开接口不该按内容完整度筛选（那是运营视角）').toBe(2)
  })
})
