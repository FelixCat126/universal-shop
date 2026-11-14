/**
 * 用户端订单列表的**状态筛选**与合计口径
 *
 * ## 发现的 bug
 *
 * 用户端 `GET /api/orders?status=paid,completed`（逗号分隔多状态）会
 * **静默返回 0 条订单** —— 因为它把原始字符串直接塞进 where.status：
 *   where.status = 'paid,completed' → 匹配不到任何单。
 *
 * 静默错误结果是最坏的一种错：用户看到"我没有订单"，其实是自己（或前端）
 * 传错了筛选，而接口一声不吭。管理端订单列表**支持**多状态（有 DA-7 用例），
 * 两端行为不一致。
 *
 * ## 用例
 *   US-1 逗号分隔的多个状态 → 订单数正确（不再静默空列表）
 *   US-2 非法状态 → 400（而不是静默返回空列表）
 *   US-3 合计与列表口径一致（筛选后合计只算筛出来的那些）
 *   US-4 未筛选时：已取消/未付款不计入合计，但订单仍在列表里
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'

const models = () => TestDatabase.getSequelize().models

let user
let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900006666'
  }))
  token = TestHelpers.generateToken(user)
})

async function mkOrder (status, amount) {
  return models().Order.create({
    order_no: `US${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    user_id: user.id,
    total_amount: amount,
    total_amount_thb: amount,
    currency_code: 'THB',
    payment_method: 'cod',
    status,
    contact_name: '筛选',
    contact_phone: '13800138000',
    delivery_address: 'A',
    exchange_rate: 1
  })
}

describe('用户端订单列表的状态筛选', () => {
  it('US-1 逗号分隔的多个状态 → 订单数正确', async () => {
    await mkOrder('paid', 100)
    await mkOrder('completed', 300)
    await mkOrder('cancelled', 200)

    const res = await request(app).get('/api/orders?status=paid,completed')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const list = res.body?.data?.orders || []
    expect(list.length, '多状态筛选返回了空列表（静默错误结果）').toBe(2)
    expect(list.map(o => o.status).sort()).toEqual(['completed', 'paid'])
  })

  it('US-2 非法状态 → 400（不是静默返回空列表）', async () => {
    await mkOrder('paid', 100)
    const res = await request(app).get('/api/orders?status=paid,fake_status')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status, '非法状态必须明确报错').toBe(400)
    expect(String(res.body?.message || '')).toMatch(/fake_status/)
  })

  it('US-3 合计与列表口径一致（筛选后合计只算筛出来的那些）', async () => {
    await mkOrder('paid', 100)
    await mkOrder('completed', 300)

    const res = await request(app).get('/api/orders?status=paid')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Number(res.body?.data?.spent_thb_sum)).toBe(100)
  })

  it('US-4 未筛选：已取消/未付款不计入合计，但订单仍在列表里', async () => {
    await mkOrder('paid', 100)
    await mkOrder('cancelled', 200)
    await mkOrder('pending', 400)

    const res = await request(app).get('/api/orders')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect((res.body?.data?.orders || []).length).toBe(3)
    expect(Number(res.body?.data?.spent_thb_sum), '只有已付款的计入合计').toBe(100)
  })
})
