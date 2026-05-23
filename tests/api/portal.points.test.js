/**
 * P1 用户面 — 积分（4 用例）
 *   PT-1 GET /points/balance happy → 200 + balance
 *   PT-2 GET /points/balance 未登录 → 401
 *   PT-3 GET /points/transactions happy → 200 分页
 *   PT-4 充值后流水正确
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

describe('P1.portal.points', () => {
  it('PT-1 GET /points/balance happy → 200 + balance', async () => {
    const { user, token } = await userWithToken()
    await TestHelpers.topUpUserPoints(user, 7)

    const res = await request(app)
      .get('/api/users/points/balance')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.balance).toBe(7)
  })

  it('PT-2 GET /points/balance 未登录 → 401', async () => {
    const res = await request(app).get('/api/users/points/balance')
    expect(res.status).toBe(401)
  })

  it('PT-3 GET /points/transactions happy → 200 分页', async () => {
    const { user, token } = await userWithToken()
    await TestHelpers.topUpUserPoints(user, 1)
    await TestHelpers.topUpUserPoints(user, 1)

    const res = await request(app)
      .get('/api/users/points/transactions?page=1&limit=20')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBe(2)
    expect(res.body.data.total).toBe(2)
  })

  it('PT-4 充值流水正确（balance_after 单调递增）', async () => {
    const { user, token } = await userWithToken()
    await TestHelpers.topUpUserPoints(user, 3)
    await TestHelpers.topUpUserPoints(user, 5)

    const res = await request(app)
      .get('/api/users/points/transactions?page=1&limit=20')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const items = res.body.data.items
    // DESC 排序
    expect(items[0].balance_after).toBe(8)
    expect(items[1].balance_after).toBe(3)
  })
})
