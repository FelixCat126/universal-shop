/**
 * P2 合作方 — 订单查询（3 用例）
 *   PQ-1 GET /api/partner/orders 列表 happy → 200 分页
 *   PQ-2 GET /api/partner/orders/:id 详情 happy
 *   PQ-3 跨方访问别人订单 → 404
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

async function partnerOrder (partner, overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { PartnerOrder } = sequelize.models
  return PartnerOrder.create(TestDataFactory.createPartnerOrder(partner.id, overrides))
}

describe('P2.partner.order.query', () => {
  it('PQ-1 列表 happy', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress()
    await partnerOrder(partner)
    await partnerOrder(partner)

    const res = await request(app).get('/api/partner/orders?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.orders.length).toBe(2)
    expect(res.body.data.pagination.total).toBe(2)
  })

  it('PQ-2 详情 happy', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress()
    const o = await partnerOrder(partner)

    const res = await request(app).get(`/api/partner/orders/${o.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(o.id)
  })

  it('PQ-3 跨方访问 → 404', async () => {
    const { partner: owner } = await TestHelpers.createPartnerWithAddress()
    const { token: otherToken } = await TestHelpers.createPartnerWithAddress()
    const o = await partnerOrder(owner)

    const res = await request(app).get(`/api/partner/orders/${o.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
    expect(res.status).toBe(404)
  })
})
