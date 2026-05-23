/**
 * P2 合作方 — 支付确认（3 用例）
 *   PY-1 agent 待付款订单 confirm → 200，status='submitted'，online_paid_at 已写
 *   PY-2 重复 confirm → 200 幂等
 *   PY-3 跨方访问别人订单 → 404
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

async function pendingPaymentOrder (partner) {
  const sequelize = TestDatabase.getSequelize()
  const { PartnerOrder } = sequelize.models
  return PartnerOrder.create(
    TestDataFactory.createPartnerOrder(partner.id, {
      status: 'pending_payment',
      total_amount_thb: 1000
    })
  )
}

describe('P2.partner.payment', () => {
  it('PY-1 confirm happy → 200 + submitted', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress({
      account_kind: 'agent'
    })
    const o = await pendingPaymentOrder(partner)

    const res = await request(app)
      .post(`/api/partner/orders/${o.id}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { PartnerOrder } = sequelize.models
    const fresh = await PartnerOrder.findByPk(o.id)
    expect(fresh.status).toBe('submitted')
    expect(fresh.online_paid_at).toBeTruthy()
  })

  it('PY-2 重复 confirm → 200 幂等', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress({
      account_kind: 'agent'
    })
    const o = await pendingPaymentOrder(partner)

    const r1 = await request(app)
      .post(`/api/partner/orders/${o.id}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
    const r2 = await request(app)
      .post(`/api/partner/orders/${o.id}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
  })

  it('PY-3 跨方访问别人订单 → 404', async () => {
    const { partner: owner } = await TestHelpers.createPartnerWithAddress({ account_kind: 'agent' })
    const { token: otherToken } = await TestHelpers.createPartnerWithAddress({ account_kind: 'agent' })
    const o = await pendingPaymentOrder(owner)

    const res = await request(app)
      .post(`/api/partner/orders/${o.id}/confirm-payment`)
      .set('Authorization', `Bearer ${otherToken}`)
    expect(res.status).toBe(404)
  })
})
