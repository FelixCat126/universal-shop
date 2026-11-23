/**
 * API 缓存语义护栏（第 52 轮）
 * =============================
 *
 * ## 为什么需要
 *
 * 在接 CDN 之前查出来的一个**真实前置缺陷**：
 * API 响应**完全没有 Cache-Control 头**。
 *
 * 浏览器会按 RFC 7234 的启发式缓存自行判断（动态响应通常无 Last-Modified，
 * 所以实际不缓存），但 **CDN / 中间代理不这么判** ——
 * 阿里云 CDN 这类默认对所有 GET 请求缓存，不看源站有没有给 Cache-Control。
 *
 * 上了 CDN 之后的典型事故：
 *   客户下单 → 客户端请求订单列表 → 命中 CDN 里的旧列表 →
 *   **页面显示"没有这笔订单"**；库存、汇率、配置同理滞后。
 *
 * 所以在**应用层**把语义钉死：API 一律 `no-store`，
 * 只给少数确实是公开只读、允许短暂滞后的接口放宽到 60s。
 *
 * ## 用例
 *
 *   CC-1 订单/购物车/用户等**带状态**的接口 → no-store
 *   CC-2 管理端接口 → no-store
 *   CC-3 公开只读接口（商品/分类/公开配置）→ public, max-age=60
 *   CC-4 **非 GET 方法**绝不能被标成可缓存（POST /api/products/check-stock 是前缀内的 POST）
 *   CC-5 静态资源**不受影响**（仍是 7d immutable —— CDN 该缓存的就是它）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

/** 取响应的 Cache-Control 头 */
function cacheControlOf (res) {
  return res.headers['cache-control'] || ''
}

describe('API 缓存语义护栏', () => {
  let user
  let userToken
  let admin
  let adminToken

  beforeAll(async () => {
    await TestDatabase.clearAllData()
    const { User } = TestDatabase.getSequelize().models
    user = await User.create({
      username: 'cache_guard_user',
      email: 'cache_guard@example.com',
      password: 'Cache#2026',
      nickname: '缓存护栏',
      country_code: '+66',
      phone: '812340088',
      is_active: true
    })
    userToken = TestHelpers.generateToken(user)
    admin = await TestHelpers.createAdminUser({ role: 'admin' })
    adminToken = TestHelpers.generateAdminToken(admin)
  })

  it('CC-1 带状态的接口（订单/购物车/个人资料）→ no-store', async () => {
    const orders = await request(app).get('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
    expect(cacheControlOf(orders)).toContain('no-store')

    const cart = await request(app).get('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
    expect(cacheControlOf(cart)).toContain('no-store')

    const profile = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect(cacheControlOf(profile)).toContain('no-store')
  })

  it('CC-2 管理端接口 → no-store', async () => {
    const stats = await request(app).get('/api/admin/statistics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(cacheControlOf(stats)).toContain('no-store')
  })

  it('CC-3 公开只读接口 → CDN 可缓存，但浏览器不缓存（s-maxage 而非 max-age）', async () => {
    const products = await request(app).get('/api/products?page=1&pageSize=1')
    expect(cacheControlOf(products)).toContain('public')
    // ⚠️ 必须是 s-maxage：max-age 会让**浏览器**也缓存 60 秒，
    // 管理端新建商品后刷新仍看到旧列表（第 52 轮的 AJ-2 就是这么挂的）
    expect(cacheControlOf(products)).toContain('s-maxage=60')
    expect(cacheControlOf(products)).toContain('max-age=0')

    const categories = await request(app).get('/api/product-categories')
    expect(cacheControlOf(categories)).toContain('s-maxage=60')

    const publicConfig = await request(app).get('/api/system-config/public')
    expect(cacheControlOf(publicConfig)).toContain('s-maxage=60')
  })

  it('CC-4 非 GET 方法绝不能被标成可缓存', async () => {
    // /api/products/check-stock 在可缓存前缀之内，但它是 POST
    const res = await request(app).post('/api/products/check-stock')
      .send({ productIds: [1] })
    expect(res.status).toBeLessThan(500)
    expect(cacheControlOf(res)).toContain('no-store')
    expect(cacheControlOf(res)).not.toContain('public')
  })

  it('CC-5 静态资源不受影响（仍是长期缓存 —— CDN 该缓存的就是它）', async () => {
    const res = await request(app).get('/portal/assets/index.js')
    // 文件不存在也会走静态中间件；关键是**不能**被 API 的 no-store 规则命中
    expect(cacheControlOf(res)).not.toContain('no-store')
  })
})
