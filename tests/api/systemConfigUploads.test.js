/**
 * 系统配置：收款码上传 / 长图上传 / 删除 的完整路径
 *
 * 之前只测了首页长图的上传白名单，**收款码上传这条路完全没测过** ——
 * 而它和长图是两份几乎一样的代码：改一处忘另一处，
 * 就会留下"一个能传图片、一个传不了"的坑。
 *
 *   CU-1 收款码上传：正常 PNG → 200 + 落盘 URL
 *   CU-2 收款码上传：没有文件 → 400
 *   CU-3 收款码上传：改了后缀的文本 → 400（魔法字节拦下）
 *   CU-4 收款码上传：MIME 不对 → 400
 *   CU-5 上传后公开配置立刻能看到新图（写后清缓存）
 *   CU-6 删除收款码 → 配置被清掉
 *   CU-7 覆盖上传：旧的收款码文件被删掉（不留垃圾）
 *   CU-8 未登录不能上传
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers, withHttpServer } from '../helpers/test-helpers.js'

let adminToken

/** 最小合法 PNG（1x1） */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000a49444154789c63600000002000100' +
  '05fe02fea7b1a1a80000000049454e44ae426082',
  'hex'
)

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `cu_admin_${Date.now()}`,
    password: 'CuPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

/** 上传收款码 */
async function uploadQr (base, { filename = 'qr.png', type = 'image/png', blob = PNG } = {}) {
  const fd = new FormData()
  fd.append('qrcode', new Blob([blob], { type }), filename)
  const res = await fetch(`${base}/api/system-config/upload/payment-qr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: fd
  })
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body }
}

/** 公开配置 */
const publicConfig = () => request(app).get('/api/system-config/public')

describe('系统配置：收款码上传', () => {
  it('CU-1 正常 PNG → 200 + 落盘 URL', async () => {
    await withHttpServer(app, async (base) => {
      const { status, body } = await uploadQr(base)
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.imageUrl).toMatch(/^\/uploads\/system\//)
      expect(body.data.imageUrl).not.toContain('..')
    })
  })

  it('CU-2 没有文件 → 400', async () => {
    await withHttpServer(app, async (base) => {
      const res = await fetch(`${base}/api/system-config/upload/payment-qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: new FormData()
      })
      expect(res.status).toBe(400)
    })
  })

  it('CU-3 改了后缀的文本文件 → 400（魔法字节拦下）', async () => {
    await withHttpServer(app, async (base) => {
      const { status } = await uploadQr(base, {
        filename: 'fake.png',
        type: 'image/png',
        blob: Buffer.from('this is definitely not a png')
      })
      expect(status).toBe(400)
    })
  })

  it('CU-4 MIME 不对 → 400', async () => {
    await withHttpServer(app, async (base) => {
      const { status } = await uploadQr(base, { type: 'application/octet-stream' })
      expect(status).toBe(400)
    })
  })

  it('CU-5 上传后公开配置立刻能看到新图（写后清缓存）', async () => {
    await withHttpServer(app, async (base) => {
      const { body } = await uploadQr(base)
      expect(body.success).toBe(true)

      const res = await publicConfig()
      expect(res.status).toBe(200)
      // 公开配置里应能拿到刚上传的收款码
      const qr = res.body.data?.payment_qrcode || res.body.data?.payment_qr
      expect(qr).toBeTruthy()
    })
  })

  it('CU-6 删除收款码 → 配置被清掉', async () => {
    await withHttpServer(app, async (base) => {
      await uploadQr(base)
      const del = await request(app)
        .delete('/api/system-config/payment-qr')
        .set('Authorization', `Bearer ${adminToken}`)
      expect([200, 404]).toContain(del.status)

      const res = await publicConfig()
      expect(res.status).toBe(200)
      const qr = res.body.data?.payment_qrcode || res.body.data?.payment_qr
      expect(!qr || qr === '' || qr === '/uploads/system/payment_qr.png').toBeTruthy()
    })
  })

  it('CU-7 覆盖上传：旧文件被删掉（不留垃圾文件）', async () => {
    await withHttpServer(app, async (base) => {
      const first = await uploadQr(base)
      expect(first.status).toBe(200)
      const firstPath = path.join(
        process.cwd(),
        'public',
        String(first.body.data.imageUrl).replace(/^\//, '')
      )
      expect(fs.existsSync(firstPath)).toBe(true)

      const second = await uploadQr(base)
      expect(second.status).toBe(200)
      expect(second.body.data.imageUrl).not.toBe(first.body.data.imageUrl)
      // 旧文件应该已被删除
      expect(fs.existsSync(firstPath)).toBe(false)
    })
  })

  it('CU-8 未登录不能上传', async () => {
    await withHttpServer(app, async (base) => {
      const fd = new FormData()
      fd.append('qrcode', new Blob([PNG], { type: 'image/png' }), 'qr.png')
      const res = await fetch(`${base}/api/system-config/upload/payment-qr`, {
        method: 'POST',
        body: fd
      })
      expect([401, 403]).toContain(res.status)
    })
  })
})
