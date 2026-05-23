/**
 * P1 用户面 — 地址 CRUD + 默认地址唯一性（5 用例）
 *   AD-1 POST 创建地址 happy → 201
 *   AD-2 POST 第二个地址传 is_default=true，原默认被切换为非默认
 *   AD-3 PUT /:id/default 设置默认 → 200，原默认变 false
 *   AD-4 PUT /:id 更新地址 → 200 字段同步
 *   AD-5 DELETE 默认地址 → 自动让最早地址成新默认
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

async function userWithToken () {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const u = await User.create(
    await TestDataFactory.createUser({
      country_code: '+86',
      phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    })
  )
  return { user: u, token: TestHelpers.generateToken(u) }
}

const VALID_ADDR = {
  contact_name: '收货人',
  contact_country_code: '+86',
  contact_phone: '13900000888',
  province: 'TH',
  city: 'Bangkok',
  district: 'Pathum Wan',
  detail_address: '111 Test Road',
  postal_code: '10330'
}

describe('P1.portal.address', () => {
  it('AD-1 POST 创建地址 happy → 201', async () => {
    const { token } = await userWithToken()
    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, is_default: true })
    expect(res.status).toBe(201)
    expect(res.body.data.is_default).toBe(true)
  })

  it('AD-2 第二个地址 is_default=true，原默认被取消', async () => {
    const { user, token } = await userWithToken()
    const r1 = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000901', is_default: true })
    const r2 = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000902', is_default: true })
    expect(r2.status).toBe(201)

    const sequelize = TestDatabase.getSequelize()
    const { Address } = sequelize.models
    const defaults = await Address.count({ where: { user_id: user.id, is_default: true } })
    expect(defaults).toBe(1)
    const stillDefault = await Address.findByPk(r2.body.data.id)
    expect(stillDefault.is_default).toBe(true)
    const oldOne = await Address.findByPk(r1.body.data.id)
    expect(oldOne.is_default).toBe(false)
  })

  it('AD-3 PUT /:id/default 设置默认 → 200', async () => {
    const { user, token } = await userWithToken()
    const r1 = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000911', is_default: true })
    const r2 = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000912', is_default: false })

    const sd = await request(app)
      .put(`/api/addresses/${r2.body.data.id}/default`)
      .set('Authorization', `Bearer ${token}`)
    expect(sd.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Address } = sequelize.models
    expect((await Address.findByPk(r1.body.data.id)).is_default).toBe(false)
    expect((await Address.findByPk(r2.body.data.id)).is_default).toBe(true)
  })

  it('AD-4 PUT /:id 更新地址 → 200 字段同步', async () => {
    const { token } = await userWithToken()
    const r1 = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000921' })

    const upd = await request(app)
      .put(`/api/addresses/${r1.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000921', detail_address: '222 New Road' })
    expect(upd.status).toBe(200)
    expect(upd.body.data.detail_address).toBe('222 New Road')
  })

  it('AD-5 DELETE 默认地址 → 自动让最早地址成新默认', async () => {
    const { user, token } = await userWithToken()
    const r1 = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000931', is_default: false })
    const r2 = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDR, contact_phone: '13900000932', is_default: true })

    const del = await request(app)
      .delete(`/api/addresses/${r2.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const sequelize = TestDatabase.getSequelize()
    const { Address } = sequelize.models
    const remaining = await Address.findAll({
      where: { user_id: user.id },
      order: [['created_at', 'ASC']]
    })
    expect(remaining.length).toBe(1)
    expect(remaining[0].is_default).toBe(true)
    expect(remaining[0].id).toBe(r1.body.data.id)
  })
})
