/**
 * 管理端积分管理（AP 用例）
 *
 *   AP-1  GET  /api/admin/points/overview —— 概览合计正确
 *   AP-2  POST /api/admin/points/users/:id/adjust（正数）→ 余额增加 + 流水 + balance_after
 *   AP-3  POST /api/admin/points/users/:id/adjust（负数）→ 余额减少
 *   AP-4  POST /api/admin/points/users/:id/adjust（余额不足）→ 400 且余额不变
 *   AP-5  GET  /api/admin/points/users/:id/transactions —— 分页正确
 *   AP-6  无 users 权限的管理员 → 403
 *   AP-7  GET  /api/admin/points/users —— 关键字/余额区间筛选
 *   AP-8  非法入参 → 400（delta 为 0 / 用户不存在）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers, waitForCondition } from '../helpers/test-helpers.js'
import { ROLE_PERMISSIONS } from '@server/models/Administrator.js'

const models = () => TestDatabase.getSequelize().models

let admin
let token
let user

beforeEach(async () => {
  await TestDatabase.clearAllData()
  admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: '13900001234',
    nickname: '积分测试用户'
  }))
})

/**
 * 权限表是全局单例（ROLE_PERMISSIONS），改它会影响其它用例 ——
 * 所以必须记得改完立刻恢复。
 */
const originalOperatorPermissions = ROLE_PERMISSIONS.operator
afterEach(() => {
  ROLE_PERMISSIONS.operator = originalOperatorPermissions
})

describe('P-admin.points · 概览', () => {
  it('AP-1 概览接口返回正确的合计', async () => {
    // 用户 A：余额 100（发放过 150、消耗 50）
    await TestHelpers.topUpUserPoints(user, 150)
    const { UserPointBalance, PointTransaction } = models()
    // 换购扣了 50：余额与流水同步（这里直接改余额行，模拟已发生的业务流水）
    const balance = await UserPointBalance.findOne({ where: { user_id: user.id } })
    await balance.update({ balance: 100 })
    await PointTransaction.create({
      user_id: user.id,
      order_id: null,
      type: 'redeem_order',
      delta: -50,
      balance_after: 100,
      note: '积分换购扣减'
    })
    // 用户 B：余额 20
    const other = await models().User.create(await TestDataFactory.createUser({
      country_code: '+66',
      phone: '890000111',
      nickname: '另一个用户'
    }))
    await TestHelpers.topUpUserPoints(other, 20)

    const res = await request(app).get('/api/admin/points/overview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.totalUsers).toBe(2)
    expect(res.body.data.totalBalance).toBe(120)
    expect(res.body.data.totalGranted).toBe(170)
    expect(res.body.data.totalConsumed).toBe(50)
  })
})

describe('P-admin.points · 手工调整', () => {
  it('AP-2 手工发放：余额增加 + 流水有记录 + balance_after 正确', async () => {
    await TestHelpers.topUpUserPoints(user, 100)

    const res = await request(app).post(`/api/admin/points/users/${user.id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: 50, note: '售后补偿' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.balance_before).toBe(100)
    expect(res.body.data.balance_after).toBe(150)

    // 余额行
    const { UserPointBalance } = models()
    const balance = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(balance.balance)).toBe(150)

    // 流水：类型 admin_adjust、delta、balance_after、备注
    const { PointTransaction } = models()
    const tx = await PointTransaction.findOne({
      where: { user_id: user.id, type: 'admin_adjust' },
      order: [['id', 'DESC']]
    })
    expect(tx).toBeTruthy()
    expect(Number(tx.delta)).toBe(50)
    expect(Number(tx.balance_after)).toBe(150)
    expect(tx.note).toBe('售后补偿')

    // 操作日志（logOperation 是响应发出后才异步写的，要等它落库）
    const { OperationLog } = models()
    const opLog = await waitForCondition(async () => OperationLog.findOne({
      where: { action: 'adjust_user_points' }
    }))
    expect(opLog.resource).toBe('user_points')
    expect(Number(opLog.admin_id)).toBe(Number(admin.id))
  })

  it('AP-3 手工扣减：余额减少，balance_after 正确', async () => {
    await TestHelpers.topUpUserPoints(user, 100)

    const res = await request(app).post(`/api/admin/points/users/${user.id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: -30, note: '纠正重复发放' })

    expect(res.status).toBe(200)
    expect(res.body.data.balance_before).toBe(100)
    expect(res.body.data.balance_after).toBe(70)

    const { UserPointBalance, PointTransaction } = models()
    const balance = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(balance.balance)).toBe(70)

    const tx = await PointTransaction.findOne({
      where: { user_id: user.id, type: 'admin_adjust' },
      order: [['id', 'DESC']]
    })
    expect(Number(tx.delta)).toBe(-30)
    expect(Number(tx.balance_after)).toBe(70)
  })

  it('AP-4 余额不足：400 且余额与流水都不变', async () => {
    await TestHelpers.topUpUserPoints(user, 50)

    const res = await request(app).post(`/api/admin/points/users/${user.id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: -80, note: '扣太多了' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toContain('积分余额不足')

    // 余额没变
    const { UserPointBalance, PointTransaction } = models()
    const balance = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(Number(balance.balance)).toBe(50)

    // 也没有多余的流水
    const count = await PointTransaction.count({
      where: { user_id: user.id, type: 'admin_adjust' }
    })
    expect(count).toBe(0)
  })

  it('AP-8 非法入参：delta 为 0 → 400；用户不存在 → 404', async () => {
    const zero = await request(app).post(`/api/admin/points/users/${user.id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: 0, note: 'x' })
    expect(zero.status).toBe(400)

    const missing = await request(app).post('/api/admin/points/users/99999999/adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: 10, note: 'x' })
    expect(missing.status).toBe(404)
  })
})

describe('P-admin.points · 流水与列表', () => {
  it('AP-5 流水查询能分页', async () => {
    // 造 5 条流水
    for (let i = 0; i < 5; i++) {
      await TestHelpers.topUpUserPoints(user, 10)
    }

    const page1 = await request(app)
      .get(`/api/admin/points/users/${user.id}/transactions?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${token}`)
    expect(page1.status).toBe(200)
    expect(page1.body.data.items.length).toBe(2)
    expect(page1.body.data.total).toBe(5)
    expect(page1.body.data.page).toBe(1)
    expect(page1.body.data.pageSize).toBe(2)
    expect(page1.body.data.totalPages).toBe(3)

    const page3 = await request(app)
      .get(`/api/admin/points/users/${user.id}/transactions?page=3&pageSize=2`)
      .set('Authorization', `Bearer ${token}`)
    expect(page3.status).toBe(200)
    expect(page3.body.data.items.length).toBe(1)

    // 流水按时间倒序
    const created = page1.body.data.items.map(i => new Date(i.created_at).getTime())
    expect(created[0]).toBeGreaterThanOrEqual(created[1])
  })

  it('AP-7 用户积分余额列表：关键字与余额区间筛选', async () => {
    await TestHelpers.topUpUserPoints(user, 100)
    const other = await models().User.create(await TestDataFactory.createUser({
      country_code: '+66',
      phone: '890000222',
      nickname: '筛选目标'
    }))
    await TestHelpers.topUpUserPoints(other, 500)

    const all = await request(app).get('/api/admin/points/users')
      .set('Authorization', `Bearer ${token}`)
    expect(all.status).toBe(200)
    expect(all.body.data.total).toBe(2)

    // 昵称关键字（中文要编码后再拼进 query）
    const byNickname = await request(app)
      .get(`/api/admin/points/users?keyword=${encodeURIComponent('筛选目标')}`)
      .set('Authorization', `Bearer ${token}`)
    expect(byNickname.status).toBe(200)
    expect(byNickname.body.data.total).toBe(1)
    expect(byNickname.body.data.items[0].user_id).toBe(other.id)
    expect(byNickname.body.data.items[0].balance).toBe(500)

    // 手机号关键字
    const byPhone = await request(app).get('/api/admin/points/users?keyword=890000222')
      .set('Authorization', `Bearer ${token}`)
    expect(byPhone.body.data.total).toBe(1)

    // 用户 id：**精确**筛选走 user_id 参数（keyword 是模糊匹配，
    // 数字 id 可能正好是某个手机号的子串，不能用来断言"只有一个人"）
    const byId = await request(app).get(`/api/admin/points/users?user_id=${user.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(byId.body.data.total).toBe(1)
    expect(byId.body.data.items[0].user_id).toBe(user.id)

    // 数字关键字也会命中用户 id（同时也可能是手机号的子串，所以只断言"包含目标用户"）
    const byIdKeyword = await request(app).get(`/api/admin/points/users?keyword=${user.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(byIdKeyword.status).toBe(200)
    expect(byIdKeyword.body.data.items.some(i => i.user_id === user.id)).toBe(true)

    // 余额区间
    const byBalance = await request(app).get('/api/admin/points/users?min_balance=200')
      .set('Authorization', `Bearer ${token}`)
    expect(byBalance.body.data.total).toBe(1)
    expect(byBalance.body.data.items[0].user_id).toBe(other.id)
  })
})

describe('P-admin.points · 权限', () => {
  it('AP-6 无 users 权限的管理员 → 403', async () => {
    // 模拟一个"没有 users 权限"的角色（当前三种角色都有 users，
    // 所以这里临时从权限表里摘掉，用例结束后恢复）
    ROLE_PERMISSIONS.operator = ROLE_PERMISSIONS.operator.filter(p => p !== 'users')

    const operator = await TestHelpers.createAdminUser({ role: 'operator' })
    const operatorToken = TestHelpers.generateAdminToken(operator)

    const overview = await request(app).get('/api/admin/points/overview')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(overview.status).toBe(403)

    const list = await request(app).get('/api/admin/points/users')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(list.status).toBe(403)

    const adjust = await request(app).post(`/api/admin/points/users/${user.id}/adjust`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ delta: 10, note: '越权尝试' })
    expect(adjust.status).toBe(403)

    // 权限不足时余额不能被动过
    const { UserPointBalance } = models()
    const balance = await UserPointBalance.findOne({ where: { user_id: user.id } })
    expect(balance).toBeNull()
  })

  it('AP-6b 有 users 权限的角色（operator）可以查看', async () => {
    const operator = await TestHelpers.createAdminUser({ role: 'operator' })
    const operatorToken = TestHelpers.generateAdminToken(operator)

    const res = await request(app).get('/api/admin/points/overview')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(res.status).toBe(200)
  })

  it('AP-6c 未登录 → 401', async () => {
    const res = await request(app).get('/api/admin/points/overview')
    expect(res.status).toBe(401)
  })
})
