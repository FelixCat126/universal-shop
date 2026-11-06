/**
 * 上传接口测试（uploadController）
 *
 * 上传是安全敏感入口：文件会落到磁盘并对外提供 URL。
 * 关键点：
 *   - **魔法字节**判定真实类型（改后缀名骗不过去）
 *   - 落盘文件名随机化（用户输入不进路径）
 *   - 头像与商品图走不同的目录与体积限制
 *   - 删除只能删本目录下的文件（不能 ../ 越权删别的文件）
 *   - 未登录不能上传
 *
 *   UL-1 未登录上传 → 401
 *   UL-2 商品图：正常 PNG → 200，返回 URL 且落盘名随机
 *   UL-3 商品图：改了后缀的文本文件 → 400（魔法字节拦下）
 *   UL-4 商品图：没有文件 → 400
 *   UL-5 头像：正常 PNG → 200
 *   UL-6 删除商品图：存在则删掉并返回成功
 *   UL-7 删除商品图：文件名含路径穿越 → 拒绝（不删任何东西）
 *   UL-8 删除商品图：文件不存在 → 404
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { imageVariants } from '@/utils/imageVariants.js'
import sharp from 'sharp'

const models = () => TestDatabase.getSequelize().models
const UPLOAD_ROOT = path.resolve(process.cwd(), 'public/uploads')

/** 一张真 PNG（1x1） */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000a49444154789c63600000002000100' +
  '05fe02fea7b1a1a80000000049454e44ae426082',
  'hex'
)

let adminToken
let userToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator, User } = models()
  const admin = await Administrator.create({
    username: `up_admin_${Date.now()}`,
    password: 'UploadPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  userToken = TestHelpers.generateToken(user)
})

describe('上传接口', () => {
  it('UL-1 未登录不能上传', async () => {
    const res = await request(app)
      .post('/api/upload/avatar')
      .attach('avatar', PNG, { filename: 'a.png', contentType: 'image/png' })
    expect(res.status).toBe(401)
  })

  it('UL-2 商品图：正常 PNG → 200，落盘名随机且不含用户文件名', async () => {
    const res = await request(app)
      .post('/api/upload/product-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', PNG, { filename: '我的商品图.png', contentType: 'image/png' })

    expect(res.status).toBe(200)
    const { filename, url } = res.body.data
    // 落盘名随机化：不含用户原始文件名
    expect(filename).not.toContain('我的商品图')
    expect(url).toBe(`/uploads/products/${filename}`)
    expect(fs.existsSync(path.join(UPLOAD_ROOT, 'products', filename))).toBe(true)
    fs.rmSync(path.join(UPLOAD_ROOT, 'products', filename), { force: true })
  })

  it('UL-3 商品图：改了后缀的文本文件 → 400（魔法字节拦下）', async () => {
    const res = await request(app)
      .post('/api/upload/product-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.from('这不是图片，只是一段文本'), {
        filename: 'fake.png',
        contentType: 'image/png'
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/图片|格式/)
  })

  it('UL-4 商品图：没有文件 → 400', async () => {
    const res = await request(app)
      .post('/api/upload/product-image')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(400)
  })

  it('UL-5 头像：正常 PNG → 200', async () => {
    const res = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' })
    expect(res.status).toBe(200)
    expect(res.body.data.url).toMatch(/^\/uploads\/(avatars|users)\//)
  })

  it('UL-6 删除商品图：存在则删掉', async () => {
    const dir = path.join(UPLOAD_ROOT, 'products')
    fs.mkdirSync(dir, { recursive: true })
    const name = `unit_test_${Date.now()}.png`
    fs.writeFileSync(path.join(dir, name), PNG)

    const res = await request(app)
      .delete(`/api/upload/product-image/${name}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(dir, name))).toBe(false)
  })

  it('UL-7 删除商品图：文件名含路径穿越 → 拒绝，不删任何东西', async () => {
    // 在 uploads 之外放一个"哨兵"文件，验证它不会被删
    const sentinel = path.join(UPLOAD_ROOT, 'sentinel.txt')
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
    fs.writeFileSync(sentinel, 'keep me')

    const res = await request(app)
      .delete('/api/upload/product-image/..%2Fsentinel.txt')
      .set('Authorization', `Bearer ${adminToken}`)

    // 无论是 400（拦下）还是 404（找不到），哨兵都必须还在
    expect([400, 404]).toContain(res.status)
    expect(fs.existsSync(sentinel)).toBe(true)
    fs.rmSync(sentinel, { force: true })
  })

  it('UL-9 上传后自动生成 WebP 主图 + 缩略图/中图变体', async () => {
    // 用一张真实尺寸的图（1x1 的退化图缩略后和主图一样大，验不了"变体更小"）
    const big = await sharp({
      create: { width: 900, height: 900, channels: 3, background: { r: 30, g: 120, b: 200 } }
    }).png().toBuffer()

    const res = await request(app)
      .post('/api/upload/product-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', big, { filename: '管线测试.png', contentType: 'image/png' })

    expect(res.status).toBe(200)
    const { filename, url, variants } = res.body.data

    // 主图统一转成 WebP（URL 不再是 .png）
    expect(filename).toMatch(/\.webp$/)
    expect(url).toBe(`/uploads/products/${filename}`)

    // 变体落盘
    const dir = path.join(UPLOAD_ROOT, 'products')
    expect(fs.existsSync(path.join(dir, filename))).toBe(true)
    expect(variants.thumb).toBeTruthy()
    expect(variants.mid).toBeTruthy()
    expect(fs.existsSync(path.join(dir, path.basename(variants.thumb)))).toBe(true)
    expect(fs.existsSync(path.join(dir, path.basename(variants.mid)))).toBe(true)

    // 缩略图必须比主图小（否则 srcset 白做）
    const mainSize = fs.statSync(path.join(dir, filename)).size
    const thumbSize = fs.statSync(path.join(dir, path.basename(variants.thumb))).size
    expect(thumbSize).toBeLessThan(mainSize)

    // 前端按约定推出的变体名要和后端生成的**完全一致**（否则浏览器下不到缩略图）
    const derived = imageVariants(url)
    expect(derived.thumb).toBe(variants.thumb)
    expect(derived.mid).toBe(variants.mid)

    for (const f of [filename, path.basename(variants.thumb), path.basename(variants.mid)]) {
      fs.rmSync(path.join(dir, f), { force: true })
    }
  }, 30000)

  it('UL-8 删除商品图：文件不存在 → 404', async () => {
    const res = await request(app)
      .delete(`/api/upload/product-image/not_exist_${Date.now()}.png`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })
})
