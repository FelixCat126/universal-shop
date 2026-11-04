/**
 * 异步导出任务（8 用例）
 *
 * 覆盖：
 *   EJ-1  创建任务 → 立即返回 jobId（不阻塞）
 *   EJ-2  worker 执行任务 → 状态变 done + 生成文件 + 行数正确
 *   EJ-3  下载已完成文件 → 200 且是合法 xlsx
 *   EJ-4  下载未完成任务 → 409
 *   EJ-5  同一管理员同类任务重复提交 → 复用已有任务
 *   EJ-6  只能看到/下载自己的任务（越权防护）
 *   EJ-7  不支持的导出类型 → 400
 *   EJ-8  清理：老任务与文件被清除
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import ExportJob from '@server/models/ExportJob.js'
import { ROLE_PERMISSIONS } from '@server/models/Administrator.js'
import {
  createExportJob,
  processPendingExportJobs,
  cleanupExportJobs,
  recoverStaleExportJobs
} from '@server/services/exportJobService.js'
import fs from 'fs'

const models = () => TestDatabase.getSequelize().models

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('ExportJob.async', () => {
  it('EJ-1 创建任务立即返回 jobId', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'users' })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.job.id).toBeGreaterThan(0)
    expect(res.body.data.job.status).toBe('pending')
  })

  it('EJ-2 worker 执行后状态 done 且行数正确', async () => {
    const { User } = models()
    for (let i = 0; i < 5; i++) {
      await User.create(await TestDataFactory.createUser({
        country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
      }))
    }
    const { token } = await adminCtx()
    await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'users' })

    const processed = await processPendingExportJobs(5)
    expect(processed).toBeGreaterThan(0)

    const job = await ExportJob.findOne({ order: [['id', 'DESC']] })
    expect(job.status).toBe('done')
    // 行数必须精确：keyset 游标写错（用 id < cursor 而游标=max id）会漏掉最新一条
    expect(job.row_count).toBe(5)
    expect(job.file_path).toBeTruthy()
    expect(fs.existsSync(job.file_path)).toBe(true)
  })

  it('EJ-3 下载已完成文件返回 xlsx', async () => {
    const { token } = await adminCtx()
    await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'users' })
    await processPendingExportJobs(5)
    const job = await ExportJob.findOne({ order: [['id', 'DESC']] })

    const res = await request(app).get(`/api/admin/export/jobs/${job.id}/download`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
  })

  it('EJ-4 下载未完成任务返回 409', async () => {
    const { token } = await adminCtx()
    const job = await createExportJob({ adminId: 1, adminUsername: 'x', type: 'users' })
    const res = await request(app).get(`/api/admin/export/jobs/${job.id}/download`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(409)
  })

  it('EJ-5 同类任务重复提交复用已有任务', async () => {
    const { token } = await adminCtx()
    const first = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users' })
    expect(first.status).toBe(201)
    const second = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users' })
    expect(second.status).toBe(200)
    expect(second.body.data.reused).toBe(true)
    expect(second.body.data.job.id).toBe(first.body.data.job.id)
    const count = await ExportJob.count()
    expect(count).toBe(1)
  })

  it('EJ-6 越权：普通管理员不能下载他人任务', async () => {
    const { admin: owner } = await adminCtx()
    const job = await createExportJob({
      adminId: owner.id, adminUsername: owner.username, type: 'users'
    })
    // 用 admin 角色（无 '*' 通配）测试 —— super_admin 本就有跨账号查看权
    const { token: otherToken } = await adminCtx('admin')
    const res = await request(app).get(`/api/admin/export/jobs/${job.id}/download`)
      .set('Authorization', `Bearer ${otherToken}`)
    expect(res.status).toBe(403)
  })

  it('EJ-7 不支持的导出类型返回 400', async () => {
    const { token } = await adminCtx()
    const res = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'secret_table' })
    expect(res.status).toBe(400)
  })

  it('EJ-8 清理：老任务与文件被清除', async () => {
    const { User } = models()
    await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
    }))
    const { token } = await adminCtx()
    await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users' })
    await processPendingExportJobs(5)
    const job = await ExportJob.findOne({ order: [['id', 'DESC']] })
    const filePath = job.file_path
    expect(fs.existsSync(filePath)).toBe(true)

    // 把任务改成 10 天前（Sequelize timestamps 会覆盖 created_at，用原生 SQL）
    const sequelize = TestDatabase.getSequelize()
    await sequelize.query('UPDATE export_jobs SET created_at = ? WHERE id = ?', {
      replacements: [new Date(Date.now() - 10 * 86400000), job.id]
    })
    const r = await cleanupExportJobs({ keepDays: 7 })
    expect(r.removed).toBeGreaterThan(0)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(await ExportJob.count()).toBe(0)
  })

  it('EJ-9 僵死任务（进程中断）被回收为 failed', async () => {
    const { token } = await adminCtx()
    await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users' })

    // 模拟进程在导出中途被杀掉：状态停在 running，开始时间很久以前
    const sequelize = TestDatabase.getSequelize()
    await sequelize.query(
      'UPDATE export_jobs SET status = ?, started_at = ? WHERE id = (SELECT MAX(id) FROM export_jobs)',
      { replacements: ['running', new Date(Date.now() - 60 * 60000)] }
    )

    const recovered = await recoverStaleExportJobs({ staleMinutes: 30 })
    expect(recovered).toBe(1)
    const job = await ExportJob.findOne({ order: [['id', 'DESC']] })
    expect(job.status).toBe('failed')
    expect(job.error_message).toContain('中断')
  })

  it('EJ-10 任务列表不被导出限流器拦截（前端需要轮询）', async () => {
    // 限流在测试环境是关闭的，这里做结构校验：
    // GET /jobs 只能挂 listJobs 一个处理器，不能挂 exportLimiter，
    // 否则前端每 3 秒轮询一次会被 10 次/分的导出限流直接打断。
    const router = (await import('@server/routes/exportRoutes.js')).default
    const listLayer = router.stack.find(
      l => l.route && l.route.path === '/jobs' && l.route.methods.get
    )
    expect(listLayer).toBeTruthy()
    expect(listLayer.route.stack).toHaveLength(1)

    // 对照：创建任务必须挂限流（它会真的去跑数据库导出）
    const createLayer = router.stack.find(
      l => l.route && l.route.path === '/jobs' && l.route.methods.post
    )
    expect(createLayer.route.stack.length).toBeGreaterThan(1)
  })

  it('EJ-11 下载时复核类型权限（权限被收回后不再放行）', async () => {
    const { admin: owner, token } = await adminCtx('admin')
    const job = await createExportJob({
      adminId: owner.id, adminUsername: owner.username, type: 'users'
    })
    await processPendingExportJobs(5)

    // 现有三种角色都带 users/orders 权限，无法用换角色模拟「权限被收回」，
    // 这里直接临时改权限表（控制器按角色实时查表，不缓存）
    const saved = [...ROLE_PERMISSIONS.admin]
    ROLE_PERMISSIONS.admin = ['orders']
    try {
      const res = await request(app).get(`/api/admin/export/jobs/${job.id}/download`)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
    } finally {
      ROLE_PERMISSIONS.admin = saved
    }
  })

  it('EJ-12 任务列表只返回自己的任务', async () => {
    const { admin: a, token: tokenA } = await adminCtx()
    const { admin: b, token: tokenB } = await adminCtx()
    await createExportJob({ adminId: a.id, adminUsername: a.username, type: 'users' })
    await createExportJob({ adminId: b.id, adminUsername: b.username, type: 'orders' })

    const res = await request(app).get('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${tokenB}`)
    expect(res.status).toBe(200)
    const jobs = res.body.data.jobs
    expect(jobs).toHaveLength(1)
    expect(jobs[0].type).toBe('orders')
    // 不能泄露磁盘路径
    expect(jobs[0].file_path).toBeUndefined()
    expect(JSON.stringify(jobs)).not.toContain('shop-exports')

    const resA = await request(app).get('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
    expect(resA.body.data.jobs).toHaveLength(1)
    expect(resA.body.data.jobs[0].type).toBe('users')
  })

  it('EJ-13 导出行数遵守筛选条件（用户）', async () => {
    const { User } = models()
    for (const email of ['a@x.com', 'b@x.com', 'c@y.com']) {
      await User.create(await TestDataFactory.createUser({
        email,
        username: email.split('@')[0],
        country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
      }))
    }
    const { admin, token } = await adminCtx()
    await createExportJob({
      adminId: admin.id,
      adminUsername: admin.username,
      type: 'users',
      params: { email: 'x.com' }
    })
    await processPendingExportJobs(5)
    const job = await ExportJob.findOne({ order: [['id', 'DESC']] })
    // a@x.com 与 b@x.com 命中，c@y.com 不命中
    expect(job.status).toBe('done')
    expect(job.row_count).toBe(2)
  })

  it('EJ-13b 导出的 xlsx 内容与筛选条件一致', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { User } = models()
    for (const email of ['a@x.com', 'b@x.com', 'c@y.com']) {
      await User.create(await TestDataFactory.createUser({
        email,
        username: `u_${email.split('@')[0]}`,
        country_code: '+86', phone: TestHelpers.generatePhoneNumber('+86')
      }))
    }
    const { admin } = await adminCtx()
    await createExportJob({
      adminId: admin.id,
      adminUsername: admin.username,
      type: 'users',
      params: { email: 'x.com' }
    })
    await processPendingExportJobs(5)
    const job = await ExportJob.findOne({ order: [['id', 'DESC']] })

    // 直接读回生成的文件，确认表头 + 行内容都对
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(job.file_path)
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('用户列表')
    expect(ws.getRow(1).values.slice(1)).toEqual(
      ['ID', '用户名', '昵称', '邮箱', '手机号', '推荐码', '被推荐码', '注册时间', '更新时间']
    )
    const emails = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values
      emails.push(v[4])
    }
    expect(emails.sort()).toEqual(['a@x.com', 'b@x.com'])
  })

  it('EJ-14 筛选条件不同则不复用旧任务', async () => {
    const { token } = await adminCtx()
    const first = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users', email: 'a@x.com' })
    expect(first.status).toBe(201)

    // 同条件 → 复用
    const same = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users', email: 'a@x.com' })
    expect(same.status).toBe(200)
    expect(same.body.data.reused).toBe(true)

    // 不同条件 → 新建（否则改了筛选导出还是旧结果）
    const diff = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`).send({ type: 'users', email: 'b@x.com' })
    expect(diff.status).toBe(201)
    expect(diff.body.data.reused).toBe(false)
    expect(diff.body.data.job.id).not.toBe(first.body.data.job.id)
  })

  it('EJ-15 非法筛选参数被丢弃，不透传到导出层', async () => {
    const { admin, token } = await adminCtx()
    const res = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'users', evil: 'x'.repeat(500), email: 'ok@x.com', __proto__: 'x' })
    expect(res.status).toBe(201)
    const job = await ExportJob.findByPk(res.body.data.job.id)
    expect(job.params.evil).toBeUndefined()
    expect(job.params.email).toBe('ok@x.com')
    // 限长生效
    const long = await request(app).post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'users', keyword: 'y'.repeat(300) })
    const job2 = await ExportJob.findByPk(long.body.data.job.id)
    expect(job2.params.keyword.length).toBeLessThanOrEqual(100)
  })
})
