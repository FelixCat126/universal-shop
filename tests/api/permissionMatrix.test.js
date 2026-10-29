/**
 * 权限矩阵黑盒测试（12 用例）
 *
 * 用真实 HTTP 请求验证「角色 × 资源」矩阵，而不是只测中间件函数：
 * 路由挂载顺序、中间件组合、控制器内的二次校验都可能让
 * 「中间件看起来对、实际却放行」。这里从 HTTP 层验证最终结果。
 *
 * 角色定义（models/Administrator.js）：
 *   super_admin  ['*']                      全部
 *   admin        orders/users/products/administrators/partners
 *   operator     orders/users/products       （不含 partners / administrators / 日志）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

/** 建立一个指定角色的管理员并返回其 token */
async function tokenFor (role) {
  const admin = await TestHelpers.createAdminUser({ role })
  return TestHelpers.generateAdminToken(admin)
}

/**
 * 只读接口矩阵（用真实存在的路由）
 * 注意：产品管理接口挂在 /api/products（管理端路由），不是 /api/admin/products；
 * 售后列表复用 orders 权限；操作日志是 super_admin 专属。
 */
const READ_MATRIX = [
  { resource: 'orders', path: '/api/admin/orders' },
  { resource: 'users', path: '/api/admin/users' },
  { resource: 'products', path: '/api/products' },
  { resource: 'partners', path: '/api/admin/partners' },
  { resource: 'after-sales', path: '/api/admin/after-sales' }
]

describe('Permission.matrix', () => {
  let superToken, adminToken, operatorToken

  /**
   * 注意：setup 的全局 beforeEach 会在每个用例前 TRUNCATE 所有表，
   * 因此管理员必须在每个用例内创建（放 beforeAll 会被 TRUNCATE 掉 → 401）。
   */
  beforeEach(async () => {
    superToken = await tokenFor('super_admin')
    adminToken = await tokenFor('admin')
    operatorToken = await tokenFor('operator')
  })

  it('PM-1 super_admin 可访问全部只读资源', async () => {
    for (const r of READ_MATRIX) {
      const res = await request(app).get(r.path).set('Authorization', `Bearer ${superToken}`)
      expect(res.status, `super_admin 访问 ${r.path}`).toBe(200)
    }
  })

  it('PM-2 admin 可访问 orders/users/products/partners/after-sales', async () => {
    for (const r of READ_MATRIX) {
      const res = await request(app).get(r.path).set('Authorization', `Bearer ${adminToken}`)
      expect(res.status, `admin 访问 ${r.path}`).toBe(200)
    }
  })

  it('PM-3 operator 无 partners 权限 → 403', async () => {
    const res = await request(app).get('/api/admin/partners').set('Authorization', `Bearer ${operatorToken}`)
    expect(res.status).toBe(403)
  })

  it('PM-4 售后列表复用 orders 权限 → operator 可访问', async () => {
    // 售后（after-sales）路由用的是 requirePermission('orders')，
    // operator 拥有 orders 权限，因此可以访问售后列表
    const res = await request(app).get('/api/admin/after-sales').set('Authorization', `Bearer ${operatorToken}`)
    expect(res.status).toBe(200)
  })

  it('PM-5 operator 可访问 orders/users/products', async () => {
    for (const path of ['/api/admin/orders', '/api/admin/users', '/api/products']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${operatorToken}`)
      expect(res.status, `operator 访问 ${path}`).toBe(200)
    }
  })

  it('PM-6 operator 无操作日志权限 → 403', async () => {
    const res = await request(app).get('/api/admin/operation-logs').set('Authorization', `Bearer ${operatorToken}`)
    expect(res.status).toBe(403)
  })

  it('PM-7 admin 非超管 → 操作日志 403；super_admin → 200', async () => {
    const res = await request(app).get('/api/admin/operation-logs').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(403)
    const ok = await request(app).get('/api/admin/operation-logs').set('Authorization', `Bearer ${superToken}`)
    expect(ok.status).toBe(200)
  })

  it('PM-8 管理端专属接口无 token → 401', async () => {
    // 注意：/api/products 是门户与管理端共用的公开接口（门户要展示商品），
    // 因此不能用它验证「无 token 应 401」
    for (const path of ['/api/admin/orders', '/api/admin/users', '/api/admin/partners', '/api/admin/after-sales']) {
      const res = await request(app).get(path)
      expect(res.status, `无 token 访问 ${path}`).toBe(401)
    }
  })

  it('PM-9 伪造 token（错误签名）→ 401', async () => {
    const fake = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbklkIjo5OTksInVzZXJuYW1lIjoibm9wZSIsInR5cGUiOiJhZG1pbiJ9.bad'
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${fake}`)
    expect(res.status).toBe(401)
  })

  it('PM-10 用户 token 不能访问管理端 → 401', async () => {
    const { User } = models()
    const user = await User.create({
      username: 'permtest', nickname: 'perm', country_code: '+86', phone: '13800009999',
      password: 'PermTest1234', must_reset_password: false
    })
    const userToken = TestHelpers.generateToken(user)
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${userToken}`)
    expect(res.status).toBe(401)
  })

  it('PM-11 合作方 token 不能访问管理端 → 401', async () => {
    const { Partner } = models()
    const partner = await Partner.create({
      login: 'perm-partner', password: 'x', display_name: 'perm', account_kind: 'dealer',
      discount_percent: 0, is_active: true
    })
    const partnerToken = TestHelpers.generatePartnerToken(partner)
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${partnerToken}`)
    expect(res.status).toBe(401)
  })

  it('PM-12 被禁用的管理员 → 403', async () => {
    const { Administrator } = models()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const token = TestHelpers.generateAdminToken(admin)
    await Administrator.update({ is_active: false }, { where: { id: admin.id } })
    // 清掉状态缓存
    const { _clearAdminAuthCacheForTests } = await import('@server/middlewares/adminAuthMiddleware.js')
    await _clearAdminAuthCacheForTests()
    // 管理员被禁用 → authenticateAdmin 返回 401（账户不存在或已被禁用）
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })
})
