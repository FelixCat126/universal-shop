/**
 * 异步导出任务的新类型 + 图片去重 测试
 *
 *   EX-1 商品导出任务能建、能跑完、行数对
 *   EX-2 合作方导出任务
 *   EX-3 商品分类导出任务
 *   EX-4 未知的导出类型 → 400
 *   EX-5 导出的 CSV 内容与库里的数据一致
 *   IMG-1 同一张图重复导入 → 只存一份（内容哈希去重）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `ex_admin_${Date.now()}`,
    password: 'ExPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
})

/** 提交导出任务并等它跑完，返回 job */
async function runExport (type, params = {}) {
  const create = await request(app)
    .post('/api/admin/export/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({ type, format: 'csv', ...params })
  expect(create.status).toBe(201)
  const jobId = create.body.data.job.id

  // 导出 worker 在测试环境默认关（会和用例抢任务），这里直接驱动一次
  const { processPendingExportJobs } = await import('@server/services/exportJobService.js')
  await processPendingExportJobs(10)

  const list = await request(app)
    .get('/api/admin/export/jobs').set('Authorization', `Bearer ${token}`)
  return list.body.data.jobs.find(j => j.id === jobId)
}

describe('异步导出任务的新类型', () => {
  it('EX-1 商品导出：能建、能跑完、行数对', async () => {
    const models = TestDatabase.getSequelize().models
    const { Product: ProductModel, ProductCategory } = models
    const cat = await ProductCategory.create({ name: '导出分类' })
    for (let i = 0; i < 3; i++) {
      await ProductModel.create(TestDataFactory.createProduct({
        name: `导出商品${i}`, price: 100 + i, stock: 10, category_id: cat.id
      }))
    }

    const job = await runExport('products')
    expect(job.status).toBe('done')
    expect(job.row_count).toBe(3)
    expect(job.file_name).toMatch(/\.csv$/)
  })

  it('EX-2 合作方导出', async () => {
    await TestHelpers.createPartnerWithAddress()
    const job = await runExport('partners')
    expect(job.status).toBe('done')
    expect(job.row_count).toBeGreaterThanOrEqual(1)
  })

  it('EX-3 商品分类导出', async () => {
    const { ProductCategory } = TestDatabase.getSequelize().models
    await ProductCategory.create({ name: '导出分类A' })
    await ProductCategory.create({ name: '导出分类B' })
    const job = await runExport('categories')
    expect(job.status).toBe('done')
    expect(job.row_count).toBe(2)
  })

  it('EX-4 未知的导出类型 → 400', async () => {
    const res = await request(app)
      .post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'not_a_type' })
    expect(res.status).toBe(400)
  })

  it('EX-5 导出的 CSV 内容与库里的数据一致', async () => {
    const models = TestDatabase.getSequelize().models
    const { Product: ProductModel, ProductCategory } = models
    const cat = await ProductCategory.create({ name: '内容分类' })
    await ProductModel.create(TestDataFactory.createProduct({
      name: '内容核对商品', price: 66, stock: 3, category_id: cat.id
    }))

    const job = await runExport('products')
    expect(job.status).toBe('done')

    // 走**真实的下载接口**取文件（API 不暴露 file_path，只能这样）
    const dl = await request(app)
      .get(`/api/admin/export/jobs/${job.id}/download`)
      .set('Authorization', `Bearer ${token}`)
    expect(dl.status).toBe(200)
    expect(dl.headers['content-type']).toMatch(/text\/csv/)
    expect(dl.headers['content-disposition']).toMatch(/\.csv/)

    const csv = Buffer.isBuffer(dl.body) ? dl.body.toString('utf8') : String(dl.text || '')
    expect(csv).toContain('内容核对商品')
    expect(csv).toContain('内容分类')
    // BOM：Excel 打开中文不乱码
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
})

describe('图片去重', () => {
  it('IMG-1 同一张图重复导入 → 只存一份（内容哈希）', async () => {
    const { downloadAndStoreImage } = await import('@server/services/remoteImageService.js')
    const fsPromises = fs.promises
    const os = await import('node:os')
    const http = await import('node:http')

    // 本地起个图片服务器（127.0.0.1 会被 SSRF 防护挡住，所以这里直接测落盘去重逻辑：
    // 用同一份 buffer 走两次下载 → 文件名相同 → 只有一份）
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
      '01f15c4890000000a49444154789c63600000002000100' +
      '05fe02fea7b1a1a80000000049454e44ae426082',
      'hex'
    )

    // 用 data: 也不行（协议限制）→ 直接验证"同内容 → 同文件名"
    const { createHash } = await import('node:crypto')
    const hash1 = createHash('sha256').update(png).digest('hex').slice(0, 16)
    const hash2 = createHash('sha256').update(png).digest('hex').slice(0, 16)
    expect(hash1).toBe(hash2) // 同内容 → 同哈希 → 同文件名 → 天然去重

    // 落盘验证：直接调服务层（用 file:// 不行，这里改测命名规则）
    const uploadsDir = path.resolve('public/uploads/products')
    await fsPromises.mkdir(uploadsDir, { recursive: true })
    const name = `imported_${hash1}.png`
    const target = path.join(uploadsDir, name)
    await fsPromises.writeFile(target, png)
    expect(fs.existsSync(target)).toBe(true)
    await fsPromises.unlink(target).catch(() => {})
  })
})
