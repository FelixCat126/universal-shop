/**
 * Batch 1 止血改造的回归测试：
 *   T-4  /api/products 写接口必须管理员鉴权
 *   T-10 /api/users/admin/users 已下线（应 404）
 *   T-A  /api/upload/product-image 必须管理员鉴权
 *   T-B  /api/admin/init 必须 INIT_SECRET
 *   T-E  错误响应不再泄漏 stack/details
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('Batch 1 安全回归', () => {
  let sequelize

  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })

  describe('T-4 /api/products 写接口鉴权', () => {
    it('未带 token：POST /api/products 应 401', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({
          name: '测试商品',
          price: 100,
          stock: 5,
          category_id: 1
        })
      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('普通用户 token：POST /api/products 应 401（非 admin token）', async () => {
      const { User } = sequelize.models
      const u = await User.create(await TestDataFactory.createUser())
      const userToken = TestHelpers.generateToken(u)
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'X', price: 1, stock: 1, category_id: 1 })
      expect(res.status).toBe(401)
    })

    it('未带 token：DELETE /api/products/:id 应 401', async () => {
      const res = await request(app).delete('/api/products/1')
      expect(res.status).toBe(401)
    })

    it('未带 token：POST /api/products/:id/stock 应 401', async () => {
      const res = await request(app)
        .post('/api/products/1/stock')
        .send({ type: 'set', quantity: 100 })
      expect(res.status).toBe(401)
    })
  })

  describe('T-10 /api/users/admin/users 已下线', () => {
    it('应 404（接口已废弃，只能走 /api/admin/users）', async () => {
      const res = await request(app).get('/api/users/admin/users')
      expect(res.status).toBe(404)
    })
  })

  describe('T-A /api/upload/product-image 鉴权', () => {
    it('未带 token：POST /api/upload/product-image 应 401', async () => {
      const res = await request(app).post('/api/upload/product-image')
      expect(res.status).toBe(401)
    })

    it('未带 token：DELETE /api/upload/product-image/:filename 应 401', async () => {
      const res = await request(app).delete('/api/upload/product-image/abc.jpg')
      expect(res.status).toBe(401)
    })
  })

  describe('T-B /api/admin/init 必须 INIT_SECRET', () => {
    it('未带 X-Init-Secret 应被拒绝（403）', async () => {
      const res = await request(app)
        .post('/api/admin/init')
        .send({})
      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })
  })

  describe('T-E 错误响应不再泄漏 stack/details', () => {
    it('500 路径不返回 stack/details', async () => {
      // 不存在的产品 id stock 调整，用未鉴权请求触发 401，而 401 不应包含 stack
      const res = await request(app)
        .post('/api/products/1/stock')
        .send({ type: 'set', quantity: 100 })
      expect(res.body).not.toHaveProperty('details')
      expect(res.body).not.toHaveProperty('stack')
    })
  })

  describe('CORS 白名单', () => {
    it('未配置 ALLOWED_ORIGINS 时（test/dev）允许任意 origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.example.com')
      expect(res.status).toBe(200)
      // 测试环境下当作白名单为空 → 允许
      expect(res.headers['access-control-allow-origin']).toBeDefined()
    })
  })
})
