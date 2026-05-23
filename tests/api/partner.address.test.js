/**
 * P2 合作方 — 地址 CRUD + 默认地址（4 用例）
 *   PD-1 POST 创建地址 happy → 201，第一条自动 is_default
 *   PD-2 PUT /:id 更新地址 → 200 字段同步
 *   PD-3 PUT /:id/default 设置默认 → 200，单 partner 仅一个默认
 *   PD-4 DELETE 默认地址 → 200，并自动让最近更新的地址成新默认
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

const ADDR_BODY = {
  recipient_name: '收货人',
  phone_country_code: '+66',
  phone: '900000111',
  province: 'TH',
  city: 'BKK',
  district: 'D1',
  postal_code: '10330',
  detail: 'Soi 1, Building A',
  label: 'Office'
}

describe('P2.partner.address', () => {
  it('PD-1 POST 创建地址 happy → 201, 第一条自动默认', async () => {
    const { token } = await TestHelpers.createPartnerWithAddress()
    // 上面 helper 已建一个默认地址；删掉它再测"第一条自动默认"
    const sequelize = TestDatabase.getSequelize()
    const { PartnerAddress } = sequelize.models
    await PartnerAddress.destroy({ where: {} })

    const res = await request(app)
      .post('/api/partner/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send(ADDR_BODY)
    expect(res.status).toBe(201)
    expect(res.body.data.is_default).toBe(true)
  })

  it('PD-2 PUT /:id 更新地址 → 200 字段同步', async () => {
    const { address, token } = await TestHelpers.createPartnerWithAddress()
    const res = await request(app)
      .put(`/api/partner/addresses/${address.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: 'NewName', phone: '900000222', detail: 'New Detail' })
    expect(res.status).toBe(200)
    expect(res.body.data.recipient_name).toBe('NewName')
    expect(res.body.data.detail).toBe('New Detail')
  })

  it('PD-3 PUT /:id/default 设置默认 → 200，仅一个默认', async () => {
    const { partner, token } = await TestHelpers.createPartnerWithAddress()
    const r2 = await request(app).post('/api/partner/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...ADDR_BODY, phone: '900000333' })

    const sd = await request(app)
      .put(`/api/partner/addresses/${r2.body.data.id}/default`)
      .set('Authorization', `Bearer ${token}`)
    expect(sd.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { PartnerAddress } = sequelize.models
    const cnt = await PartnerAddress.count({ where: { partner_id: partner.id, is_default: true } })
    expect(cnt).toBe(1)
    const stillNew = await PartnerAddress.findByPk(r2.body.data.id)
    expect(stillNew.is_default).toBe(true)
  })

  it('PD-4 DELETE 默认地址 → 200 并自动接管', async () => {
    const { partner, address, token } = await TestHelpers.createPartnerWithAddress()
    const r2 = await request(app).post('/api/partner/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...ADDR_BODY, phone: '900000444' })

    const del = await request(app)
      .delete(`/api/partner/addresses/${address.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { PartnerAddress } = sequelize.models
    const remaining = await PartnerAddress.findAll({ where: { partner_id: partner.id } })
    expect(remaining.length).toBe(1)
    expect(remaining[0].id).toBe(r2.body.data.id)
    expect(remaining[0].is_default).toBe(true)
  })
})
