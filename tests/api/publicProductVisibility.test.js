/**
 * 公开接口的「可售商品」边界（第 43 轮）
 * ================================
 *
 * ## 发现的缺陷
 *
 * 运营把商品改成 `status = 'inactive'`（下架）之后：
 *
 * | 路径 | 修复前 | 期望 |
 * |---|---|---|
 * | 商城首页 / 搜索结果 | **仍然出现该商品** | 不出现 |
 * | 商品详情页 | **仍然能打开** | 404（商品不存在或已下架） |
 * | 下单 | 400「商品已下架」（orderController 第 602 行） | 400 |
 *
 * 结果是典型的「**能看见、点得进、买不了**」——
 * 用户以为系统坏了，运营以为下架没生效（其实前台列表根本没看 status）。
 *
 * 根因：公开列表 `getProducts` 与公开详情 `getProduct` 都**没有过滤 status**，
 * 而下单路径过滤了 —— 三个接口对"什么算可售"的口径不一致。
 *
 * ## 为什么必须断言"总量"而不只是"返回的条数"
 *
 * 只断言返回的数组里没有那件商品是不够的：
 * 分页 total 是另外一条 COUNT 查询，可能仍然把下架商品算进去，
 * 前端"共 N 件商品"就会对不上。只断言 total 才能覆盖到 COUNT 那一侧。
 *
 * ## 护栏要点
 *
 * - PV-3 专门保护管理端：**管理端必须仍然看得到下架商品**，
 *   否则运营就没法检查/恢复下架商品了 —— 不能为了前台干净把后台也堵死。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

beforeEach(async () => { await TestDatabase.clearAllData() })

async function makeCategory () {
  const sequelize = TestDatabase.getSequelize()
  const { ProductCategory } = sequelize.models
  return ProductCategory.create(TestDataFactory.createProductCategory({ name: 'ShopCat' }))
}

async function makeProduct (categoryId, overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Product } = sequelize.models
  return Product.create(TestDataFactory.createProduct({
    category_id: categoryId,
    name: '可见性测试商品',
    status: 'active',
    ...overrides
  }))
}

describe('公开接口的「可售商品」边界', () => {
  it('PV-1 公开列表不含下架商品（列表与 total 都不含）', async () => {
    const cat = await makeCategory()
    await makeProduct(cat.id, { name: '在售商品', status: 'active' })
    const off = await makeProduct(cat.id, { name: '已下架商品', status: 'inactive' })

    const res = await request(app).get('/api/products?page=1&pageSize=50')
    expect(res.status).toBe(200)
    const list = res.body.data.products
    expect(list.map(p => p.id), '下架商品不能出现在商城列表里').not.toContain(off.id)
    expect(list.map(p => p.name), '下架商品不能出现在商城列表里').not.toContain('已下架商品')
    expect(res.body.data.total, 'total 也不能把下架商品算进去（COUNT 与列表口径要一致）').toBe(1)
  })

  it('PV-2 公开详情对下架商品返回 404', async () => {
    const cat = await makeCategory()
    const off = await makeProduct(cat.id, { status: 'inactive' })

    const res = await request(app).get(`/api/products/${off.id}`)
    expect(res.status, '下架商品的公开详情应当 404').toBe(404)
  })

  it('PV-3 管理端仍然看得到下架商品（不能为了前台干净把后台堵死）', async () => {
    const cat = await makeCategory()
    const off = await makeProduct(cat.id, { name: '后台要看得见', status: 'inactive' })

    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const token = TestHelpers.generateAdminToken(admin)

    const res = await request(app).get('/api/products?page=1&pageSize=50')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const list = res.body.data.products
    expect(list.map(p => p.id), '管理端必须能看到下架商品').toContain(off.id)
  })

  it('PV-4 公开搜索同样不含下架商品', async () => {
    const cat = await makeCategory()
    const off = await makeProduct(cat.id, { name: '柠檬茶', status: 'inactive' })

    const res = await request(app).get('/api/products?name=' + encodeURIComponent('柠檬'))
    expect(res.status).toBe(200)
    expect(res.body.data.products.map(p => p.id), '搜索结果不能带出下架商品').not.toContain(off.id)
  })

  it('PV-5 在售商品的公开详情不受影响（修边界不能误伤正常路径）', async () => {
    const cat = await makeCategory()
    const on = await makeProduct(cat.id, { status: 'active' })

    const res = await request(app).get(`/api/products/${on.id}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBe(on.id)
  })

  /**
   * 第 43 轮（效率）：相关推荐**随详情一起返回**。
   *
   * 之前前端是"拿到详情 → 再发一次列表请求"，而列表请求要用的 category_id
   * 只能从详情响应里拿 → 两个请求天然串行，详情页白等一个来回。
   */
  it('PV-6 详情响应带 related：同分类在售商品、不含自己、不含下架商品', async () => {
    const cat = await makeCategory()
    const cur = await makeProduct(cat.id, { name: '当前商品', status: 'active' })
    const sib = await makeProduct(cat.id, { name: '同分类在售', status: 'active' })
    const off = await makeProduct(cat.id, { name: '同分类下架', status: 'inactive' })
    const other = await makeProduct((await makeCategory()).id, { name: '别的分类', status: 'active' })

    const res = await request(app).get(`/api/products/${cur.id}`)
    expect(res.status).toBe(200)
    const related = res.body.data.related
    expect(Array.isArray(related), '详情响应必须带 related 数组').toBe(true)
    const ids = related.map(p => p.id)
    expect(ids, 'related 里不能有自己').not.toContain(cur.id)
    expect(ids, 'related 里应该有同分类的在售商品').toContain(sib.id)
    expect(ids, 'related 里不能有下架商品').not.toContain(off.id)
    expect(ids, 'related 里不能有别的分类的商品').not.toContain(other.id)
    expect(related.length, 'related 最多 4 条').toBeLessThanOrEqual(4)
  })

  it('PV-7 没有同分类商品时 related 为空数组（不是 null）', async () => {
    const cat = await makeCategory()
    const only = await makeProduct(cat.id, { status: 'active' })

    const res = await request(app).get(`/api/products/${only.id}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.related)).toBe(true)
    expect(res.body.data.related.length).toBe(0)
  })

  /**
   * 购物车必须把商品状态带给前端 ——
   * 前端要靠它判断"这件已下架"（第 43 轮前端修复依赖这个字段）。
   */
  it('PV-8 购物车接口返回商品 status（前端据此标记失效）', async () => {
    const cat = await makeCategory()
    await makeProduct(cat.id, { name: '在售', status: 'active' })
    const off = await makeProduct(cat.id, { name: '已下架', status: 'inactive' })

    const sequelize = TestDatabase.getSequelize()
    const { User, Cart } = sequelize.models
    const user = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13900003333'
    }))
    await Cart.create({ user_id: user.id, product_id: off.id, quantity: 1, price: 10 })

    const token = TestHelpers.generateToken(user)
    const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const item = res.body.data.find(i => i.product_id === off.id)
    expect(item, '购物车里应该有这件商品').toBeTruthy()
    expect(item.product.status, '购物车必须带上商品状态，否则前端无法判断已下架').toBe('inactive')
  })

  /**
   * 第 43 轮连带修的另一个不一致：「重新上架」要真的上架。
   *
   * 管理端确认框写的是「确定重新上架该商品吗？**前台将恢复展示**」，
   * 但实现只撤销软删、**不改 status** → 对"下架后又被删"的商品点重新上架，
   * 它回到库里却仍是 inactive → 前台看不见 → 运营以为已经上架了。
   */
  it('PV-9 重新上架后：商品回到公开列表，且 status 变回 active', async () => {
    const cat = await makeCategory()
    const off = await makeProduct(cat.id, { name: '下架后删除', status: 'inactive' })
    await off.destroy() // 软删

    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const token = TestHelpers.generateAdminToken(admin)

    const res = await request(app).post(`/api/products/${off.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const row = await models().Product.findByPk(off.id, { raw: true })
    expect(row.status, '「重新上架」必须真的把 status 置回 active').toBe('active')

    const pub = await request(app).get('/api/products?page=1&pageSize=50')
    const ids = pub.body.data.products.map(p => p.id)
    expect(ids, '重新上架后前台应能看见（管理端承诺"前台将恢复展示"）').toContain(off.id)
  })
})
