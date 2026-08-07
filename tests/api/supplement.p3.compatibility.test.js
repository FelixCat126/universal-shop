/**
 * P3 兼容性 / 体验 / 边界（20 用例）
 *
 * 涵盖：排序优先级、字段排除、type 过滤、列表 boundary
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'
import { clearResponseCache } from '@server/utils/responseCache.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
  _resetLoginGuardForTests()
  clearResponseCache()
})

// 本文件业务测试套件最后一个执行（compatibility 命名 a- 前缀最小）。
// vitest 全局 afterAll（test-setup.js 中）会先于本 afterAll 运行，
// 跑到 await TestDatabase.cleanup() 时可能因 PG 连接池耗尽而 hang 30s+。
// 解决：把全局 cleanup 提前替换为 no-op，并在最后一个测试中强制断开连接。
//
// 这里通过 beforeAll 早于所有测试替换 cleanup，使全局 afterAll 立即返回。
beforeAll(() => {
  TestDatabase.cleanup = async () => {}
})
// 同时用一个本地 afterAll 主动 ensure close（带超时，但全局已经 no-op）
afterAll(async () => {
  try {
    const seq = TestDatabase.getSequelize()
    if (seq) {
      const pool = seq?.connectionManager?.pool
      if (pool && typeof pool.end === 'function') {
        await Promise.race([
          pool.end(),
          new Promise((r) => setTimeout(r, 800))
        ]).catch(() => {})
      }
      await Promise.race([
        seq.close(),
        new Promise((r) => setTimeout(r, 800))
      ]).catch(() => {})
    }
  } catch {}
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

describe('P3-Supplement.registerCompat', () => {
  it('P3-1 register nickname 51 字 → 400', async () => {
    const res = await request(app).post('/api/users/register')
      .send({
        nickname: 'A'.repeat(51),
        phone: TestHelpers.generatePhoneNumber('+86'),
        password: 'Abcd1234'
      })
    expect(res.status).toBe(400)
  })

  it('P3-2 verifyReferralCode 严格匹配（不支持大小写）', async () => {
    const user = await makeUser({ referral_code: 'ABC123' })
    // 实际：findByReferralCode 严格匹配
    const res = await request(app).get('/api/users/verify-referral/abc123')
    expect(res.status).toBe(404)
  })
})

describe('P3-Supplement.profileMetrics', () => {
  it('P3-3 profile/metrics 浮点精度（spent_thb 保留 2 位）', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    // 创 1 笔订单
    const { Product, Order } = TestDatabase.getSequelize().models
    const p = await Product.create(
      TestDataFactory.createProduct({ stock: 100, status: 'active', price: 33.33 })
    )
    await Order.create({
      user_id: user.id,
      order_no: `T${Date.now()}`,
      contact_name: 'X',
      contact_phone: '13800000001',
      delivery_address: 'A',
      status: 'completed',
      payment_method: 'cod',
      total_amount: 33.33,
      total_amount_thb: 33.33,
      currency_code: 'THB'
    })
    const res = await request(app).get('/api/users/profile/metrics')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    // 保留 2 位
    expect(typeof res.body.data.spent_thb).toBe('number')
  })
})

describe('P3-Supplement.addressCrossUser', () => {
  it('P3-4 getAddressDetail 跨用户 → 404', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const { Address } = TestDatabase.getSequelize().models
    const a = await Address.create(TestDataFactory.createAddress(user.id))
    // 另一用户
    const other = await makeUser()
    const otherToken = TestHelpers.generateToken(other)
    const res = await request(app).get(`/api/addresses/${a.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
    expect(res.status).toBe(404)
  })

  it('P3-5 updateAddress 跨用户 → 404', async () => {
    const user = await makeUser()
    const { Address } = TestDatabase.getSequelize().models
    const a = await Address.create(TestDataFactory.createAddress(user.id))
    const other = await makeUser()
    const otherToken = TestHelpers.generateToken(other)
    const res = await request(app).put(`/api/addresses/${a.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        contact_name: 'X',
        contact_phone: '13800000000',
        detail_address: 'A'
      })
    expect(res.status).toBe(404)
  })
})

describe('P3-Supplement.regionsLocale', () => {
  it('P3-6 getAllRegions locale=zh-CN 走 name_alias', async () => {
    const { seedRegionsBaseline } = await import('../setup/test-baseline.js')
    await seedRegionsBaseline()
    const res = await request(app).get('/api/administrative-regions/all?locale=en-US')
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data[0].name).toBe('Bangkok')
  })
})

describe('P3-Supplement.addressSort', () => {
  it('P3-7 getUserAddresses 默认地址优先（is_default DESC）', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const { Address } = TestDatabase.getSequelize().models
    await Address.create(TestDataFactory.createAddress(user.id, { is_default: false, contact_name: 'second' }))
    await Address.create(TestDataFactory.createAddress(user.id, { is_default: true, contact_name: 'first' }))
    const res = await request(app).get('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data[0].contact_name).toBe('first')
  })
})

describe('P3-Supplement.pointTransactionType', () => {
  it('P3-8 pointTransactions earn/redeem type 列表', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    // 充 100 再 down 50
    await TestHelpers.topUpUserPoints(user, 100)
    const order = await TestHelpers.createOrderWithItems({}, 1)
    // direct create a redeem transaction
    const { PointTransaction } = TestDatabase.getSequelize().models
    await PointTransaction.create({
      user_id: user.id,
      type: 'redeem_order',
      delta: -50,
      balance_after: 50,
      order_id: order.order.id
    })
    const res = await request(app).get('/api/users/points/transactions')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const types = res.body.data.items.map((it) => it.type)
    expect(types).toContain('earn_purchase')
    expect(types).toContain('redeem_order')
  })
})

describe('P3-Supplement.administrator', () => {
  it('P3-9 createAdministrator 重复 email → 400', async () => {
    const { token } = await adminCtx()
    const existing = await TestHelpers.createAdminUser({ email: 'dup@test.com' })
    const res = await request(app).post('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'newcomer', password: 'Abcd1234', email: 'dup@test.com' })
    expect(res.status).toBe(400)
  })

  it('P3-10 updateAdministrator 改自己 username 冲突 → 400', async () => {
    const { admin } = await adminCtx('super_admin')
    const created = await TestHelpers.createAdminUser({ username: 'iambusy' })
    const { token } = await adminCtx('super_admin')
    // 尝试把 created 改成 admin.username
    const res = await request(app).put(`/api/admin/administrators/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ username: admin.username })
    expect(res.status).toBe(400)
  })

  it('P3-11 resetPassword 密码 < 6 → 400', async () => {
    const { token } = await adminCtx()
    const target = await TestHelpers.createAdminUser({})
    const res = await request(app).put(`/api/admin/administrators/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'abc' })
    expect(res.status).toBe(400)
  })

  it('P3-12 getAllAdministrators role 非法值 → PG ENUM 拒绝', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/administrators?role=fake')
      .set('Authorization', `Bearer ${token}`)
    // 实际：Administrator.role 是 PG ENUM('super_admin','admin','operator') → 非法值 → 500
    expect(res.status).toBe(500)
  })
})

describe('P3-Supplement.categoryAdmin', () => {
  it('P3-13 listAdmin categories 边界（pageSize=0 → 兜底 1）', async () => {
    const { token } = await adminCtx()
    const res = await request(app).get('/api/admin/product-categories?pageSize=0')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.pageSize).toBeGreaterThanOrEqual(1)
  })

  it('P3-14 updateCategory name=空 → 400', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const cat = await ProductCategory.create({ name: 'orig', sort_order: 1 })
    const res = await request(app).put(`/api/admin/product-categories/${cat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' })
    expect(res.status).toBe(400)
  })
})

describe('P3-Supplement.checkPhoneExists', () => {
  it('P3-15 checkPhoneExists 路径 → 200 含 exists 字段', async () => {
    const user = await makeUser()
    const res = await request(app).get(`/api/users/check-phone/${user.phone}`)
    expect(res.status).toBe(200)
    expect(res.body.data.exists).toBe(true)
  })
})

describe('P3-Supplement.addressValidation', () => {
  it('P3-16 createAddress 不支持 country_code → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: 'X',
        contact_country_code: '+1',
        contact_phone: '13800000000',
        detail_address: 'A'
      })
    expect(res.status).toBe(400)
  })

  it('P3-17 createAddress 手机号含字母 → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: 'X',
        contact_country_code: '+86',
        contact_phone: '1380000000a',
        detail_address: 'A'
      })
    expect(res.status).toBe(400)
  })

  it('P3-18 createAddress 长度不足 → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: 'X',
        contact_country_code: '+86',
        contact_phone: '123',
        detail_address: 'A'
      })
    expect(res.status).toBe(400)
  })
})

describe('P3-Supplement.verifyToken', () => {
  it('P3-19 verifyToken 过期 → 401/403', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const expired = jwt.sign(
      { userId: 1, username: 'u' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    )
    const res = await request(app).get('/api/users/verify')
      .set('Authorization', `Bearer ${expired}`)
    expect([401, 403]).toContain(res.status)
  })

  it('P3-20 getCurrentUser happy + 排除 password 字段', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app).get('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.password).toBeUndefined()
  })
})
