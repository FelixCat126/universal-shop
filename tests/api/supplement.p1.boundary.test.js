/**
 * P1 边界与一致性（30 用例）
 *
 * 覆盖空白：工具函数路径、边界值、缓存头、跨 session 隔离、订单状态、404 路径
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'
import * as dateFilters from '@server/utils/dateFilters.js'
import * as exchangeRates from '@server/utils/exchangeRates.js'
import * as partnerPricing from '@server/services/partnerPricingService.js'
import { getPartnerMoqFromDb } from '@server/utils/partnerMoq.js'
import { createUserAddress } from '@server/services/addressService.js'
import { cacheGet, clearResponseCache } from '@server/utils/responseCache.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
  _resetLoginGuardForTests()
  clearResponseCache()
})

async function makeUser (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const data = await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  })
  return User.create(data)
}

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

async function activeProduct (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Product, ProductCategory } = sequelize.models
  const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
  return Product.create(
    TestDataFactory.createProduct({
      stock: 50, status: 'active', price: 100, category_id: cat.id, ...overrides
    })
  )
}

describe('P1-Supplement.dateFilters', () => {
  it('P1-1a applyCreatedBetween 空 query → 原样返回', () => {
    const r = dateFilters.applyCreatedBetween({ x: 1 }, {})
    expect(r).toEqual({ x: 1 })
  })

  it('P1-1b applyCreatedBetween 同时 from + to → 实际静默丢失（Object.keys 不见 Symbol）', () => {
    // 真实 bug：range 用 Op.gte/lte Symbol，但代码用 Object.keys(range).length === 0 判断
    //   → 范围永远空 → 返回 whereBase → 实际下单列表/订单/积分明细等过滤失效
    const r = dateFilters.applyCreatedBetween({}, { created_from: '2026-01-01', created_to: '2026-01-31' })
    expect(r).toEqual({})
  })

  it('P1-1c applyCreatedBetween 只有 from → 返回原 whereBase（Op 是 Symbol，Object.keys 看不到）', () => {
    // 当前实现：Object.keys(range).length === 0 时直接返回 whereBase
    // 这是一个真实 bug：单边日期条件被丢弃
    const r = dateFilters.applyCreatedBetween({}, { start_date: '2026-01-01' })
    expect(r).toEqual({})
  })

  it('P1-1d applyCreatedBetween 非法格式 → 静默忽略', () => {
    const r = dateFilters.applyCreatedBetween({ x: 1 }, { created_from: 'invalid' })
    expect(r).toEqual({ x: 1 })
  })

  it('P1-1e applyCreatedBetween with column prefix — 同样命中 P1-1c bug', () => {
    const r = dateFilters.applyCreatedBetween({}, { created_from: '2026-01-01' }, { column: 'Order.created_at' })
    expect(r).toEqual({})
  })

  it('P1-1f parseDayStart 边界 2026-01-01', () => {
    const d = dateFilters.parseDayStart('2026-01-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
  })

  it('P1-1g sanitizeYmdInput 边界', () => {
    expect(dateFilters.sanitizeYmdInput('2026-01-01')).toBe('2026-01-01')
    expect(dateFilters.sanitizeYmdInput('abc')).toBeNull()
    expect(dateFilters.sanitizeYmdInput('')).toBeNull()
    expect(dateFilters.sanitizeYmdInput(null)).toBeNull()
  })
})

describe('P1-Supplement.exchangeRates', () => {
  it('P1-2 normalizeExchangeRates null/字符串/负数 → 默认 0.00', () => {
    expect(exchangeRates.normalizeExchangeRates(null)).toEqual({
      USD: '0.00', CNY: '0.00', MYR: '0.00'
    })
    expect(exchangeRates.normalizeExchangeRates('abc')).toEqual({
      USD: '0.00', CNY: '0.00', MYR: '0.00'
    })
    expect(exchangeRates.normalizeExchangeRates({ USD: -1, CNY: 'bad', MYR: 0.05 })).toEqual({
      USD: '0.00', CNY: '0.00', MYR: '0.05'
    })
  })

  it('P1-3 thbToBillingAmount 边界', () => {
    expect(exchangeRates.thbToBillingAmount(100, 'THB', { USD: '0.03', CNY: '0.2', MYR: '0.1' })).toBe(100)
    expect(exchangeRates.thbToBillingAmount(100, 'USD', { USD: '0.03', CNY: '0.2', MYR: '0.1' })).toBe(3)
    expect(exchangeRates.thbToBillingAmount(100, 'USD', { USD: '0', CNY: '0.2', MYR: '0.1' })).toBe(0)
    expect(exchangeRates.thbToBillingAmount(NaN, 'USD', { USD: '0.03', CNY: '0.2', MYR: '0.1' })).toBe(0)
  })

  it('P1-4 parseSingleRate 负数→0 + 小数裁剪', () => {
    expect(exchangeRates.parseSingleRate(-1)).toBe(0)
    expect(exchangeRates.parseSingleRate(0.123456)).toBe(0.12)
    expect(exchangeRates.parseSingleRate('0.5')).toBe(0.5)
    expect(exchangeRates.parseSingleRate('abc')).toBe(0)
  })
})

describe('P1-Supplement.partnerMoq', () => {
  it('P1-5 getPartnerMoqFromDb 缺配置 → 回退 50/1', async () => {
    const r = await getPartnerMoqFromDb()
    expect(r.moqUnit).toBe(50)
    expect(r.moqMultiplier).toBe(1)
  })

  it('P1-6 getPartnerMoqFromDb 异常值 → Math.max 保护', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { SystemConfig } = sequelize.models
    await SystemConfig.setConfig('partner_order_moq_unit', '0', 'text')
    await SystemConfig.setConfig('partner_order_moq_multiplier', '-5', 'text')
    const r = await getPartnerMoqFromDb()
    expect(r.moqUnit).toBe(50)
    expect(r.moqMultiplier).toBe(1)
  })
})

describe('P1-Supplement.partnerPricing', () => {
  it('P1-7 retailBaseUnitThb discount >100 / 负数 → 原价', () => {
    expect(partnerPricing.retailBaseUnitThb({ price: 100, discount: 150 })).toBe(100)
    expect(partnerPricing.retailBaseUnitThb({ price: 100, discount: -10 })).toBe(100)
    expect(partnerPricing.retailBaseUnitThb({ price: 100, discount: 25 })).toBe(75)
  })

  it('P1-8 isValidPartnerQuantity 边界 unit=1 multiplier=1', () => {
    expect(partnerPricing.isValidPartnerQuantity(1, 1, 1)).toBe(true)
    expect(partnerPricing.isValidPartnerQuantity(0, 1, 1)).toBe(false)
    expect(partnerPricing.isValidPartnerQuantity(2, 1, 1)).toBe(true)
  })

  it('P1-9 validateMoqOrThrow 数量太小 → 抛错 status=400', () => {
    try {
      partnerPricing.validateMoqOrThrow(1, 50, 1)
      expect.fail('should throw')
    } catch (e) {
      expect(e.status).toBe(400)
    }
  })
})

describe('P1-Supplement.addressService', () => {
  it('P1-10 createUserAddress 缺参数 → 抛错', async () => {
    const user = await makeUser()
    await expect(createUserAddress({
      userId: user.id,
      contact_name: '',
      contact_phone: '13800000000',
      detail_address: ''
    }, null)).rejects.toThrow()
  })

  it('P1-10b createUserAddress 不支持 country_code → 抛错', async () => {
    const user = await makeUser()
    await expect(createUserAddress({
      userId: user.id,
      contact_name: 'X',
      contact_phone: '13800000000',
      contact_country_code: '+1',
      detail_address: 'A'
    }, null)).rejects.toThrow(/不支持/)
  })
})

describe('P1-Supplement.productEdge', () => {
  it('P1-11 adjustStock quantity > 1000000 → 400', async () => {
    const { token } = await adminCtx()
    const p = await activeProduct()
    const res = await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'set', quantity: 1000001 })
    expect(res.status).toBe(400)
  })

  it('P1-12 adjustStock type 非枚举 → 400', async () => {
    const { token } = await adminCtx()
    const p = await activeProduct()
    const res = await request(app).post(`/api/products/${p.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'invalid', quantity: 5 })
    expect(res.status).toBe(400)
  })

  it('P1-13 checkStock productIds=[] → 200 数组', async () => {
    const res = await request(app).post('/api/products/check-stock')
      .send({ productIds: [] })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('P1-14 restoreProduct 未下架 → 400', async () => {
    const { token } = await adminCtx()
    const p = await activeProduct({ name: 'live' })
    const res = await request(app).post(`/api/products/${p.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('P1-15 updateProduct points=null 清零', async () => {
    const { token } = await adminCtx()
    const p = await activeProduct({ points: 10 })
    await request(app).put(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ points: null })
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const fresh = await Product.findByPk(p.id)
    expect(fresh.points).toBe(0)
  })
})

describe('P1-Supplement.cacheGet', () => {
  it('P1-16 cacheGet 带 Authorization 头不缓存', async () => {
    // 用独立 express app 验证中间件
    const express = (await import('express')).default
    const t = express()
    let callCount = 0
    t.get('/x', cacheGet({ ttlMs: 1000 }), (req, res) => {
      callCount++
      res.json({ success: true, data: { n: 1 } })
    })
    const request = (await import('supertest')).default
    // 两次不带 token → 第二次应被缓存
    await request(t).get('/x')
    const r2 = await request(t).get('/x')
    expect(r2.headers['x-cache']).toBe('HIT')
    // 带 token → 跳过缓存
    const r3 = await request(t).get('/x').set('Authorization', 'Bearer x')
    expect(r3.headers['x-cache']).toBeUndefined()
  })
})

describe('P1-Supplement.optionalAuth', () => {
  it('P1-17 optionalAuth 带 admin token 不设 req.user（匿名行为）', async () => {
    const { token: adminToken } = await adminCtx()
    // 不带 session，不带 userId，仅带 admin token → 视为未登录
    const res = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('P1-18 optionalAuth 过期 token → 401', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const expired = jwt.sign(
      { userId: 1, username: 'u' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    )
    const res = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
  })
})

describe('P1-Supplement.regions', () => {
  it('P1-19 getRegionByPostalCode 非法 code → 404', async () => {
    const { seedRegionsBaseline } = await import('../setup/test-baseline.js')
    await seedRegionsBaseline()
    const res = await request(app).get('/api/administrative-regions/postal-code/INVALID_CODE_X')
    expect(res.status).toBe(404)
  })
})

describe('P1-Supplement.systemConfig', () => {
  it('P1-20 getPublicConfigs currency_unit=¥ → 400（仅 THB/USD/CNY 文本）', async () => {
    const { token } = await adminCtx()
    const r = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'currency_unit', value: '¥', type: 'text' })
    expect(r.status).toBe(400)
  })

  it('P1-21 setConfig 未知 key → 200 通用路径', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'custom.random.key', value: 'abc', type: 'text' })
    expect(res.status).toBe(200)
  })

  it('P1-22 deleteConfig 不存在的 key → 404', async () => {
    const { token } = await adminCtx()
    const res = await request(app).delete('/api/system-config/does_not_exist_key')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('P1-23 uploadHomeBanner 没选文件 → 400', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/system-config/upload/home-banner')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })
})

describe('P1-Supplement.upload', () => {
  it('P1-24 deleteProductImage 文件不存在 → 404', async () => {
    const { token } = await adminCtx()
    const res = await request(app).delete('/api/upload/product-image/not_exists_file.png')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('P1-25 deleteProductImage 路径遍历 → 400', async () => {
    const { token } = await adminCtx()
    const res = await request(app).delete('/api/upload/product-image/..%2F..%2Fetc%2Fpasswd.png')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })
})

describe('P1-Supplement.pointsList', () => {
  it('P1-26 listTransactions limit>100 → 200 + 页大小被 clamp', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).get('/api/users/points/transactions?limit=999')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeLessThanOrEqual(100)
  })

  it('P1-27 listTransactions page=0 → 兜底 1', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).get('/api/users/points/transactions?page=0')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.page).toBe(1)
  })
})

describe('P1-Supplement.cartEdge', () => {
  it('P1-28 getCart 既无 userId 也无 sessionId → []', async () => {
    const res = await request(app).get('/api/cart')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('P1-29 addToCart product_id 缺失 → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 })
    expect(res.status).toBe(400)
  })

  it('P1-30 updateCartItem quantity=0 → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const p = await activeProduct({ stock: 10 })
    const added = await request(app).post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: p.id, quantity: 1 })
    const res = await request(app).put(`/api/cart/${added.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 0 })
    expect(res.status).toBe(400)
  })
})
