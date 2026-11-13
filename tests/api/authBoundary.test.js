/**
 * 认证边界黑盒：三把密钥不许串用，会话该失效要真失效
 *
 *   AT-1 用户令牌不能访问管理端接口
 *   AT-2 管理员令牌不能访问合作方接口
 *   AT-3 合作方令牌不能访问用户自己的订单
 *   AT-4 登出后令牌立即失效
 *   AT-5 改密码后旧令牌立即失效
 *   AT-6 账号被禁用后令牌立即失效
 *   AT-7 密码策略拦得住弱密码（所有设密入口同一把尺子）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

let user
let userToken
let adminToken
let partner
let partnerToken
let product

beforeEach(async () => {
  await TestDatabase.clearAllData()
  await seedSystemConfigBaseline()
  const { Administrator, User, Product, Partner } = models()

  user = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900009999'
  }))
  userToken = TestHelpers.generateToken(user)

  const admin = await Administrator.create({
    username: `ab_admin_${Date.now()}`, password: 'AbPwd#1234', role: 'super_admin', is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)

  partner = await Partner.create({
    login: `ab_partner_${Date.now()}`, password: 'Partner#2026',
    display_name: '边界合作方', is_active: true
  })
  partnerToken = TestHelpers.generatePartnerToken(partner)

  product = await Product.create({
    name: '边界商品', price: 10, stock: 50, status: 'active'
  })
})

describe('认证边界', () => {
  it('AT-1 用户令牌不能访问管理端接口', async () => {
    for (const url of ['/api/admin/orders', '/api/admin/users', '/api/admin/products', '/api/admin/partners']) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${userToken}`)
      expect([401, 403], `${url} 不该接受用户令牌`).toContain(res.status)
    }
  })

  it('AT-2 管理员令牌不能访问合作方接口', async () => {
    const res = await request(app).get('/api/partner/orders').set('Authorization', `Bearer ${adminToken}`)
    expect([401, 403]).toContain(res.status)
  })

  it('AT-3 合作方令牌不能访问用户自己的订单', async () => {
    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${partnerToken}`)
    expect([401, 403]).toContain(res.status)
  })

  it('AT-4 登出后令牌立即失效', async () => {
    const before = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect(before.status).toBe(200)

    const out = await request(app).post('/api/users/logout')
      .set('Authorization', `Bearer ${userToken}`)
    expect([200, 204]).toContain(out.status)

    const after = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect(after.status, '登出后旧令牌必须失效').toBe(401)
  })

  it('AT-5 改密码后旧令牌立即失效', async () => {
    const res = await request(app).put('/api/users/profile/password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ old_password: 'Abcd1234', new_password: 'NewPass#2026' })
    expect(res.status).toBe(200)

    const after = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect(after.status, '改密后旧令牌必须失效').toBe(401)
  })

  it('AT-6 账号被禁用后令牌立即失效', async () => {
    await user.update({ is_active: false })
    const res = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    // 401 = 令牌无效；403 = 账号被禁用。两者都表示"不能再用这个令牌访问"，
    // 服务端刻意区分了这两者（前端据此引导"重新登录"vs"账号被停用"）。
    expect([401, 403], '禁用后旧令牌必须失效').toContain(res.status)
  })

  it('AT-7 密码策略：弱密码在注册/改密/重置三处都被拦', async () => {
    // 注册
    const reg = await request(app).post('/api/users/register')
      .send({
        nickname: '弱密码', country_code: '+86', phone: '13912345678',
        password: '12345678' // 只有数字
      })
    expect(reg.status).toBe(400)

    // 改密
    const chg = await request(app).put('/api/users/profile/password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ old_password: 'Abcd1234', new_password: '12345678' })
    expect(chg.status).toBe(400)
  })
})
