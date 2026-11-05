/**
 * 导出任务 service 层测试（exportJobService）
 *
 * 覆盖 exportJob.test.js（走 HTTP 接口）没覆盖到的 service 分支：
 *   EJS-1 worker 执行**订单**导出：状态 done + 行数正确 + 生成文件
 *   EJS-2 订单导出筛选：status / 日期区间 / keyword 命中正确行数
 *   EJS-3 用户导出筛选：phone / referral_code
 *   EJS-4 导出过程抛错 → 任务置 failed + 记录 error_message
 *   EJS-5 不支持的导出类型 → 任务置 failed
 *   EJS-6 文件 TTL 清理：过期任务的文件被删、file_path 置空；未过期的保留
 *   EJS-7 任务被抢占（条件 UPDATE 影响 0 行）→ 跳过，不重复执行
 *   EJS-8 测试环境 triggerExportJobs 不自动跑（避免与用例抢任务）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import ExportJob from '@server/models/ExportJob.js'
import {
  createExportJob,
  runExportJob,
  processPendingExportJobs,
  cleanupExpiredExportFiles,
  triggerExportJobs
} from '@server/services/exportJobService.js'

const models = () => TestDatabase.getSequelize().models

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('导出任务 service', () => {
  it('EJS-1 worker 执行订单导出：状态 done + 行数正确 + 文件落盘', async () => {
    const { User, Order, Product, OrderItem } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 100, price: 100, status: 'active' })
    )
    // 造 3 张订单（含明细）
    for (let i = 0; i < 3; i++) {
      const order = await Order.create(await TestDataFactory.createOrder(user.id, {
        status: 'shipping',
        payment_method: 'cod'
      }))
      await OrderItem.create(await TestDataFactory.createOrderItem(order.id, product.id, { quantity: 2 }))
    }

    const { admin } = await adminCtx()
    const job = await createExportJob({
      adminId: admin.id,
      adminUsername: admin.username,
      type: 'orders'
    })

    await runExportJob(job)

    const done = await ExportJob.findByPk(job.id)
    expect(done.status).toBe('done')
    expect(done.row_count).toBe(3)
    expect(done.file_path).toBeTruthy()
    expect(fs.existsSync(done.file_path)).toBe(true)
    expect(done.file_size).toBeGreaterThan(0)
    expect(done.started_at).toBeTruthy()
    expect(done.completed_at).toBeTruthy()
  }, 30000)

  it('EJS-2 订单导出筛选：status / 日期区间 / keyword 只导命中行', async () => {
    const { User, Order } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const mk = async (overrides) => Order.create(await TestDataFactory.createOrder(user.id, overrides))

    await mk({ status: 'shipping', contact_name: '张三', contact_phone: '13800000001' })
    await mk({ status: 'cancelled', contact_name: '李四', contact_phone: '13800000002' })
    await mk({ status: 'shipping', contact_name: '王五', contact_phone: '13800000003' })

    const { admin } = await adminCtx()

    // 只导 shipping → 2 单
    const byStatus = await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'orders', params: { status: 'shipping' }
    })
    await runExportJob(byStatus)
    expect((await ExportJob.findByPk(byStatus.id)).row_count).toBe(2)

    // keyword 命中联系人 → 1 单
    const byKeyword = await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'orders', params: { keyword: '张三' }
    })
    await runExportJob(byKeyword)
    expect((await ExportJob.findByPk(byKeyword.id)).row_count).toBe(1)

    // 日期区间把 3 单全排除掉 → 0 行
    const byDate = await createExportJob({
      adminId: admin.id,
      adminUsername: admin.username,
      type: 'orders',
      params: {
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString()
      }
    })
    await runExportJob(byDate)
    expect((await ExportJob.findByPk(byDate.id)).row_count).toBe(0)
  }, 30000)

  it('EJS-3 用户导出筛选：phone / referral_code', async () => {
    const { User } = models()
    await User.create(await TestDataFactory.createUser({
      phone: '13900000001',
      referral_code: 'REF001'
    }))
    await User.create(await TestDataFactory.createUser({
      phone: '13900000002',
      referral_code: 'REF002'
    }))

    const { admin } = await adminCtx()

    const byPhone = await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'users', params: { phone: '13900000001' }
    })
    await runExportJob(byPhone)
    expect((await ExportJob.findByPk(byPhone.id)).row_count).toBe(1)

    const byReferral = await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'users', params: { referral_code: 'REF002' }
    })
    await runExportJob(byReferral)
    expect((await ExportJob.findByPk(byReferral.id)).row_count).toBe(1)
  }, 30000)

  it('EJS-4 导出过程抛错 → 任务置 failed 且记录 error_message', async () => {
    const { admin } = await adminCtx()
    // 构造一个「一读参数就炸」的 job：runner 内部读 job.params 时抛错
    const status = {}
    const badJob = {
      id: 987654,
      type: 'users',
      params: new Proxy({}, {
        get () { throw new Error('导出炸了') }
      }),
      update: async (patch) => { Object.assign(status, patch) }
    }

    await runExportJob(badJob)

    expect(status.status).toBe('failed')
    expect(String(status.error_message)).toContain('导出炸了')
    expect(status.completed_at).toBeTruthy()
  }, 30000)

  it('EJS-5 不支持的导出类型 → 任务置 failed', async () => {
    const status = {}
    const badJob = {
      id: 987655,
      type: 'not_a_type',
      update: async (patch) => { Object.assign(status, patch) }
    }

    await runExportJob(badJob)

    expect(status.status).toBe('failed')
    expect(status.error_message).toContain('不支持')
  })

  it('EJS-6 文件 TTL 清理：过期任务的文件被删、file_path 置空；未过期的保留', async () => {
    const { admin } = await adminCtx()
    const job = await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'users'
    })
    await runExportJob(job)

    const done = await ExportJob.findByPk(job.id)
    const filePath = done.file_path
    expect(fs.existsSync(filePath)).toBe(true)

    // 把完成时间拨到 TTL 之外（默认 48h）
    await TestDatabase.getSequelize().query(
      'UPDATE export_jobs SET completed_at = ? WHERE id = ?',
      { replacements: [new Date(Date.now() - 100 * 3600 * 1000), job.id] }
    )

    const removed = await cleanupExpiredExportFiles()
    expect(removed).toBe(1)
    expect(fs.existsSync(filePath)).toBe(false)

    const after = await ExportJob.findByPk(job.id)
    expect(after.file_path).toBeNull()
    expect(after.status).toBe('done')

    // 再跑一次：已经没有过期文件了，返回 0
    expect(await cleanupExpiredExportFiles()).toBe(0)
  }, 30000)

  it('EJS-7 任务被抢占（条件 UPDATE 影响 0 行）→ 跳过，不重复执行', async () => {
    const { admin } = await adminCtx()
    const job = await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'users'
    })

    // 模拟另一个 worker 抢先把它改成 running → 抢占失败
    const spy = vi.spyOn(ExportJob, 'update').mockResolvedValue([0])
    try {
      const processed = await processPendingExportJobs(5)
      expect(processed).toBe(1) // 扫到了 1 个候选
    } finally {
      spy.mockRestore()
    }

    // 抢占失败 → 状态没被改成 running（仍是 pending）
    const after = await ExportJob.findByPk(job.id)
    expect(after.status).toBe('pending')
  }, 30000)

  it('EJS-8 测试环境 triggerExportJobs 不自动跑（避免与用例抢任务）', async () => {
    const { admin } = await adminCtx()
    await createExportJob({
      adminId: admin.id, adminUsername: admin.username, type: 'users'
    })
    // NODE_ENV=test → 直接返回，不起后台任务
    expect(() => triggerExportJobs()).not.toThrow()

    // 任务仍是 pending（没被后台偷偷跑掉）
    const pending = await ExportJob.findAll({ where: { status: 'pending' } })
    expect(pending.length).toBe(1)
  })
})
