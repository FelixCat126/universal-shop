/**
 * 导出的筛选口径必须与**列表**完全一致
 *
 * ## 发现的三个问题（都已修）
 *
 * 1. **状态只支持单值**：前端传 `status=paid,shipping`（列表支持多状态），
 *    后端却 `where.status = 'paid,shipping'` → 去匹配字面量 → **导出一行都没有**。
 *    "列表 3 单、导出 0 行" = 报表对不上。
 * 2. **日期按 UTC 午夜切**：`[Op.between]: ['2026-11-01','2026-11-14']` 传裸字符串
 *    → PG 当 UTC 午夜 → 结束日当天的单全漏、开始日当天的单也漏 → **与列表差一天**。
 *    列表走业务时区的日历日，导出走 UTC → 两边对不上。
 * 3. **用户筛选的条件被覆盖**：`where[Op.or]` 赋值两次 → 同时传 email 与 referral_code
 *    时 email 条件被冲掉 → 导出比列表多。
 *
 * ## 用例
 *   EX-1 多状态导出：行数 = 列表行数（不是 0）
 *   EX-2 日期范围导出：结束日当天的单也在内（与列表一致）
 *   EX-3 用户多条件导出：条件是「同时满足」（与列表一致）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { createExportJob, runExportJob } from '@server/services/exportJobService.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let adminId
let adminUsername

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
  adminId = admin.id
  adminUsername = admin.username
})

/** 造一批订单 */
async function mkOrders () {
  const { Order, User } = models()
  const user = await User.create({
    username: 'ex_u_' + Date.now(), nickname: '导出用户', country_code: '+86',
    phone: '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
    password: 'Abcd1234', is_active: true
  })
  const day = (n) => new Date(Date.now() - n * 86400000)
  const mk = (status, n) => Order.create({
    order_no: 'EX' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    user_id: user.id, total_amount: 100, total_amount_thb: 100, currency_code: 'THB',
    payment_method: 'cod', status,
    contact_name: '导出', contact_phone: '13800138000', delivery_address: 'A', exchange_rate: 1,
    created_at: day(n), updated_at: day(n)
  })
  await mk('paid', 0)
  await mk('shipping', 0)
  await mk('completed', 1)
  await mk('cancelled', 1)
  return user
}

/** 跑一次导出任务，返回导出的行数 */
async function runExport (params) {
  const job = await createExportJob({
    adminId, adminUsername, type: 'orders', params
  })
  await runExportJob(job)
  const { ExportJob } = models()
  const fresh = await ExportJob.findByPk(job.id, { raw: true })
  expect(fresh.status, `导出任务失败：${fresh.error_message || ''}`).toBe('done')
  return Number(fresh.row_count)
}

describe('导出的筛选口径', () => {
  it('EX-1 多状态导出：行数 = 列表行数（不是 0）', async () => {
    await mkOrders()

    const list = await request(app).get('/api/admin/orders?status=paid,shipping')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    const listCount = Number(list.body?.data?.total)

    const rows = await runExport({ status: 'paid,shipping' })
    expect(rows, '多状态导出导出了 0 行（列表有 ' + listCount + ' 行）').toBe(listCount)
    expect(listCount).toBeGreaterThan(0)
  })

  it('EX-2 日期范围导出：结束日当天的单也在内（与列表一致）', async () => {
    await mkOrders()
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    const todayStr = `${y}-${m}-${d}`

    const list = await request(app).get(`/api/admin/orders?startDate=${todayStr}&endDate=${todayStr}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    const listCount = Number(list.body?.data?.total)

    const rows = await runExport({ startDate: todayStr, endDate: todayStr })
    expect(rows, '结束日当天的单在导出里丢了（与列表差一天）').toBe(listCount)
  })

  it('EX-3 用户多条件导出：条件是「同时满足」（与列表一致）', async () => {
    const { User } = models()
    await User.create({
      username: 'ex_a_' + Date.now(), nickname: '甲', email: 'a@example.com',
      country_code: '+86', phone: '13900001111', password: 'Abcd1234', is_active: true,
      referral_code: 'REFA'
    })
    await User.create({
      username: 'ex_b_' + Date.now(), nickname: '乙', email: 'b@example.com',
      country_code: '+86', phone: '13900002222', password: 'Abcd1234', is_active: true,
      referral_code: 'REFB'
    })

    // 筛选的两个条件各命中**不同**的人：
    //   列表（AND）= 0 行；导出若只剩 referral 条件（覆盖 bug）= 1 行 → 必然对不上
    const list = await request(app).get('/api/admin/users?email=a@example.com&referral_code=REFB')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    const listCount = Number(list.body?.data?.total ?? list.body?.data?.users?.length ?? 0)

    const job = await createExportJob({
      adminId, adminUsername, type: 'users',
      params: { email: 'a@example.com', referral_code: 'REFB' }
    })
    await runExportJob(job)
    const { ExportJob } = models()
    const fresh = await ExportJob.findByPk(job.id, { raw: true })
    expect(fresh.status).toBe('done')
    expect(Number(fresh.row_count), '用户导出比列表多（email 条件被 referral_code 覆盖）').toBe(listCount)
  })
})
