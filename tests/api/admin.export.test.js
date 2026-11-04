/**
 * P3 Admin — 导出 + 审计（4 用例）
 *   EX-1 GET /api/export/users xlsx happy → 200 + xlsx
 *   EX-2 GET /api/export/orders xlsx happy → 200 + xlsx
 *   EX-3 GET /api/admin/orders/export JSON 数组 → 200
 *   EX-4 任一导出后 OperationLog 写入一条 export 记录
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers, waitForCondition } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx () {
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

async function makeUserAndOrder () {
  const sequelize = TestDatabase.getSequelize()
  const { User, Order } = sequelize.models
  const u = await User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13988800001'
  }))
  await Order.create({
    order_no: `EX${Date.now()}`,
    user_id: u.id, total_amount: 50, total_amount_thb: 50, currency_code: 'THB',
    payment_method: 'cod', status: 'shipping',
    contact_name: 'X', contact_phone: '13988800001', delivery_address: 'A', exchange_rate: 1
  })
}

describe('P3.admin.export', () => {
  it('EX-1 GET /api/admin/export/users xlsx', async () => {
    const { token } = await adminCtx()
    await makeUserAndOrder()
    const res = await request(app).get('/api/admin/export/users')
      .set('Authorization', `Bearer ${token}`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheet/)
  })

  it('EX-2 GET /api/admin/export/orders xlsx', async () => {
    const { token } = await adminCtx()
    await makeUserAndOrder()
    const res = await request(app).get('/api/admin/export/orders')
      .set('Authorization', `Bearer ${token}`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheet/)
  })

  it('EX-2b 同步导出包含最新一条（keyset 游标不能漏掉最后一行）', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { token } = await adminCtx()
    // 造 3 个用户，其中最后一个是 id 最大的（游标以 max id 起步最容易漏）
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    for (const nick of ['u1', 'u2', 'u3']) {
      await User.create(await TestDataFactory.createUser({
        nickname: nick,
        country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
      }))
    }
    const newest = await User.findOne({ order: [['id', 'DESC']] })

    // xlsx 不是 supertest 默认会 buffer 的类型，需显式指定二进制解析器
    const res = await request(app).get('/api/admin/export/users')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = []
        r.on('data', c => chunks.push(Buffer.from(c)))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(res.body)
    const ws = wb.worksheets[0]
    const ids = []
    for (let r = 2; r <= ws.rowCount; r++) ids.push(ws.getRow(r).values[1])
    expect(ids).toContain(newest.id)
    expect(ids.length).toBe(3)
  })

  it('EX-3 GET /api/admin/orders/export JSON', async () => {
    const { token } = await adminCtx()
    await makeUserAndOrder()
    const res = await request(app).get('/api/admin/orders/export')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('EX-4 导出后 OperationLog 至少有一条 export 记录', async () => {
    const { token } = await adminCtx()
    await makeUserAndOrder()
    await request(app).get('/api/admin/export/users')
      .set('Authorization', `Bearer ${token}`).buffer(true)
    // logOperation 是 setImmediate 异步写库，轮询等待落库（替代固定 sleep）
    const sequelize = TestDatabase.getSequelize()
    const { OperationLog } = sequelize.models
    const cnt = await waitForCondition(async () => {
      const n = await OperationLog.count({ where: { action: 'export' } })
      return n >= 1 ? n : false
    })
    expect(cnt).toBeGreaterThanOrEqual(1)
  })
})
