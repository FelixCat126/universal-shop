/**
 * 抵扣券接口契约（5 用例）
 *
 * 固化真实踩过的契约错位：
 *   后端返回 data:{ list:[...] }，前端当数组用 Array.isArray(res.data.data) 判断，
 *   恒为 false → 领券中心/我的券/结算页选券全部静默变空，
 *   整个抵扣券功能在门户前台不可达（不报错，只是没有券）。
 *
 * 同时固化 available 列表必须带 per_user（前端据此判断是否还能继续领；
 * 缺失时前端会硬编码成 1，导致 per_user>1 的模板被提前判定为「已领完」）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

async function makeUserToken () {
  const { User } = models()
  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86')
  }))
  return { user, token: TestHelpers.generateToken(user) }
}

async function makeTemplate (overrides = {}) {
  const { CouponTemplate } = models()
  return CouponTemplate.create({
    name: '契约测试券',
    amount: 50,
    min_spend: 0,
    total: 100,
    per_user: 2,
    status: 'active',
    scope: { type: 'all' },
    register_gift: false,
    valid_from: new Date(Date.now() - 3600_000),
    valid_to: new Date(Date.now() + 86400_000),
    ...overrides
  })
}

describe('Coupon.contract', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
  })

  it('CC-1 GET /api/coupons/available → data 为 { list: [...] } 而非数组', async () => {
    const { token } = await makeUserToken()
    await makeTemplate()
    const res = await request(app).get('/api/coupons/available').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 契约：包装对象（前端必须用 list 取值）
    expect(Array.isArray(res.body.data)).toBe(false)
    expect(Array.isArray(res.body.data.list)).toBe(true)
    expect(res.body.data.list.length).toBe(1)
  })

  it('CC-2 available 列表项含 per_user（前端领取态判断依据）', async () => {
    const { token } = await makeUserToken()
    await makeTemplate({ per_user: 3 })
    const res = await request(app).get('/api/coupons/available').set('Authorization', `Bearer ${token}`)
    const item = res.body.data.list[0]
    expect(item).toBeDefined()
    expect(item.per_user).toBe(3)
    expect(item.claimed_by_me).toBe(0)
  })

  it('CC-3 GET /api/coupons/mine → data 为 { list: [...] }', async () => {
    const { token } = await makeUserToken()
    const res = await request(app).get('/api/coupons/mine').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(false)
    expect(Array.isArray(res.body.data.list)).toBe(true)
  })

  it('CC-4 领取后可领列表不再包含该券（claimed_by_me 达 per_user 后下架）', async () => {
    const { user, token } = await makeUserToken()
    const tpl = await makeTemplate({ per_user: 1 })
    const { CouponTemplate } = models()
    // 领一张
    const claim = await request(app).post('/api/coupons/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id })
    expect(claim.status).toBe(201)
    // 再领应被拒（超每人限领）
    const again = await request(app).post('/api/coupons/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: tpl.id })
    expect(again.status).toBe(400)
    // 可领列表里不应再有
    const avail = await request(app).get('/api/coupons/available').set('Authorization', `Bearer ${token}`)
    expect(avail.body.data.list.find(i => i.id === tpl.id)).toBeUndefined()
    // 我的券里有
    const mine = await request(app).get('/api/coupons/mine').set('Authorization', `Bearer ${token}`)
    expect(mine.body.data.list.find(i => i.template_id === tpl.id)).toBeDefined()
  })

  it('CC-5 无 token 访问 → 401', async () => {
    const res = await request(app).get('/api/coupons/available')
    expect(res.status).toBe(401)
  })
})
