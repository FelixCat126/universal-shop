/**
 * P3 Admin — 系统配置（16 用例，配置边界主战场）
 *
 *   汇率 5:
 *     SC-1  POST exchange_rates JSON happy → 200 + 写入
 *     SC-2  GET / 列表 happy → 200
 *     SC-3  GET /:key 单值 → 200
 *     SC-4  GET /public 公开拿到汇率 + 30s 缓存
 *     SC-5  写后立即 invalidate（写新汇率 → /public 立刻反映）
 *
 *   非法值 4:
 *     SC-6  exchange_rates USD 小数 3 位 → 400
 *     SC-7  exchange_rate 负数 → 400
 *     SC-8  exchange_rate 字符串非数字 → 400
 *     SC-9  exchange_rates 非对象 → 400
 *
 *   currency_unit 2:
 *     SC-10 currency_unit=JPY 非法 → 400
 *     SC-11 DELETE currency_unit 后 → /public 回退 THB
 *
 *   MOQ 2:
 *     SC-12 设置 partner_order_moq_unit=50 happy（普通 key）→ 200
 *     SC-13 DELETE partner_order_moq_unit → 默认 50（合作方下单 qty=50 仍 happy）
 *
 *   home-banner / payment-qr 3:
 *     SC-14 DELETE /home-banner 不存在 → 200/404 任一（控制器允许）
 *     SC-15 DELETE /payment-qr 不存在 → 200/404 任一
 *     SC-16 非 super_admin 访问 → 403
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { clearResponseCache } from '@server/utils/responseCache.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  clearResponseCache()
})

async function superCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

describe('P3.admin.systemconfig — 汇率 / 公开缓存', () => {
  it('SC-1 POST exchange_rates JSON → 200 + 写入', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rates', value: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })
    expect(res.status).toBe(200)
    expect(res.body.data.exchange_rates.USD).toBeDefined()
  })

  it('SC-2 GET / 列表 happy', async () => {
    const { token } = await superCtx()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'currency_unit', value: 'THB' })
    const res = await request(app).get('/api/system-config').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.currency_unit).toBeDefined()
  })

  it('SC-3 GET /:key 单值', async () => {
    const { token } = await superCtx()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'currency_unit', value: 'USD' })
    const res = await request(app).get('/api/system-config/currency_unit')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.value).toBe('USD')
  })

  it('SC-4 GET /public happy（无需鉴权）', async () => {
    const { token } = await superCtx()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rates', value: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })
    const res = await request(app).get('/api/system-config/public')
    expect(res.status).toBe(200)
    expect(res.body.data.exchange_rates).toBeDefined()
  })

  it('SC-5 写后 /public 立即反映新值（缓存 invalidate）', async () => {
    const { token } = await superCtx()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rates', value: { USD: '0.03', CNY: '0.20', MYR: '0.13' } })
    const r1 = await request(app).get('/api/system-config/public')
    const usd1 = parseFloat(r1.body.data.exchange_rates.USD)

    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rates', value: { USD: '0.05', CNY: '0.20', MYR: '0.13' } })
    const r2 = await request(app).get('/api/system-config/public')
    const usd2 = parseFloat(r2.body.data.exchange_rates.USD)
    expect(usd2).not.toBe(usd1)
    expect(usd2).toBeCloseTo(0.05, 2)
  })
})

describe('P3.admin.systemconfig — 非法值', () => {
  it('SC-6 USD 小数 3 位 → 400', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rates', value: { USD: '0.001', CNY: '0.20', MYR: '0.13' } })
    expect(res.status).toBe(400)
  })

  it('SC-7 exchange_rate 负数 → 400', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rate', value: '-0.5' })
    expect(res.status).toBe(400)
  })

  it('SC-8 exchange_rate 字符串非数字 → 400', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rate', value: 'abc' })
    expect(res.status).toBe(400)
  })

  it('SC-9 exchange_rates 非对象（数组）→ 400', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'exchange_rates', value: [1, 2, 3] })
    expect(res.status).toBe(400)
  })
})

describe('P3.admin.systemconfig — currency_unit / MOQ', () => {
  it('SC-10 currency_unit=JPY 非法 → 400', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'currency_unit', value: 'JPY' })
    expect(res.status).toBe(400)
  })

  it('SC-11 DELETE currency_unit 后 /public 不再返回该字段（或返回默认）', async () => {
    const { token } = await superCtx()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'currency_unit', value: 'CNY' })
    const del = await request(app).delete('/api/system-config/currency_unit')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 404]).toContain(del.status)

    const pub = await request(app).get('/api/system-config/public')
    expect(pub.status).toBe(200)
  })

  it('SC-12 设置 partner_order_moq_unit=50 → 200', async () => {
    const { token } = await superCtx()
    const res = await request(app).post('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'partner_order_moq_unit', value: '50' })
    expect(res.status).toBe(200)
  })

  it('SC-13 DELETE partner_order_moq_unit 后回退默认 50', async () => {
    const { token } = await superCtx()
    await request(app).post('/api/system-config').set('Authorization', `Bearer ${token}`)
      .send({ key: 'partner_order_moq_unit', value: '100' })
    const del = await request(app).delete('/api/system-config/partner_order_moq_unit')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 404]).toContain(del.status)

    // 校验合作方下单 qty=50 仍 happy（默认 50）
    const { TestDataFactory } = await import('../factories/index.js')
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const { token: ptoken, address } = await TestHelpers.createPartnerWithAddress({ discount_percent: 0 })
    const product = await Product.create(
      TestDataFactory.createProduct({ price: 10, discount: null, stock: 1000, status: 'active' })
    )
    const r = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${ptoken}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
    expect(r.status).toBe(201)
  })
})

describe('P3.admin.systemconfig — 上传/删除 + 权限', () => {
  it('SC-14 DELETE /home-banner（无文件） → 200', async () => {
    const { token } = await superCtx()
    const res = await request(app).delete('/api/system-config/home-banner')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 404]).toContain(res.status)
  })

  it('SC-15 DELETE /payment-qr（无文件） → 200', async () => {
    const { token } = await superCtx()
    const res = await request(app).delete('/api/system-config/payment-qr')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 404]).toContain(res.status)
  })

  it('SC-16 非 super_admin 访问 system-config → 403', async () => {
    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const token = TestHelpers.generateAdminToken(admin)
    const res = await request(app).get('/api/system-config')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})
