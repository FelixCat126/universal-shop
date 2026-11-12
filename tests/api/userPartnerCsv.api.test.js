/**
 * 用户 / 合作方 CSV 导入导出 —— HTTP 这一层
 *
 * 服务层逻辑在 userCsv.test.js / partnerCsv.test.js 里测过；
 * 这里测**接口层**：鉴权、权限、multipart、预览 vs 落库、错误码。
 *
 * 这两个控制器之前**完全没有接口测试**（覆盖率只有 62%），
 * 而它们是管理端唯一能批量建用户/建合作方的入口 —— 出错会直接批量造垃圾数据。
 *
 *   UC-1  未登录不能导入 / 导出
 *   UC-2  没传文件 → 400
 *   UC-3  默认是预览（不落库）
 *   UC-4  dry_run=false → 真的落库（新建用户 + 强制改密标记）
 *   UC-5  strict 模式：有问题的行 → 400 且整批不落库
 *   UC-6  skip 模式：有问题的行被跳过，好的行照常导入
 *   UC-7  导出返回 CSV（带 Content-Disposition + BOM）
 *   UC-8  导出内容能原样导回（往返）
 *   UC-9  导出失败 → 500
 *   PC-1  合作方导入落库（新建合作方 + 强制改密标记）
 *   PC-2  合作方导出返回 CSV
 *   PC-3  操作员没有合作方权限 → 403
 *   PC-4  合作方导入 strict 模式坏行 → 400
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { injectFault, restoreFaults } from '../helpers/faultInjection.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let operatorToken

const USER_CSV_HEADER = 'id,nickname,username,email,phone,country_code,referral_code,is_active'
const PARTNER_CSV_HEADER = 'id,login,display_name,account_kind,discount_percent,is_active'

/** 上传一份 CSV（用户） */
function attachUserCsv (content, { token = adminToken, dryRun, mode } = {}) {
  let req = request(app)
    .post('/api/admin/users/import')
    .set('Authorization', `Bearer ${token}`)
  if (dryRun !== undefined) req = req.field('dry_run', dryRun)
  if (mode !== undefined) req = req.field('mode', mode)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename: 'users.csv',
    contentType: 'text/csv'
  })
}

/** 上传一份 CSV（合作方） */
function attachPartnerCsv (content, { token = adminToken, dryRun, mode } = {}) {
  let req = request(app)
    .post('/api/admin/partners/import')
    .set('Authorization', `Bearer ${token}`)
  if (dryRun !== undefined) req = req.field('dry_run', dryRun)
  if (mode !== undefined) req = req.field('mode', mode)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename: 'partners.csv',
    contentType: 'text/csv'
  })
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `ucsv_admin_${Date.now()}`,
    password: 'CsvPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)

  const operator = await Administrator.create({
    username: `ucsv_op_${Date.now()}`,
    password: 'CsvPwd#1234',
    role: 'operator',
    is_active: true
  })
  operatorToken = TestHelpers.generateAdminToken(operator)
})

afterEach(() => {
  restoreFaults()
})

describe('用户 CSV 导入 / 导出 接口', () => {
  it('UC-1 未登录不能导入 / 导出', async () => {
    const noAuthImport = await request(app)
      .post('/api/admin/users/import')
      .attach('file', Buffer.from('﻿a,b', 'utf8'), { filename: 'u.csv', contentType: 'text/csv' })
    expect([401, 403]).toContain(noAuthImport.status)

    const noAuthExport = await request(app).get('/api/admin/users/export.csv')
    expect([401, 403]).toContain(noAuthExport.status)
  })

  it('UC-2 没传文件 → 400', async () => {
    const res = await request(app)
      .post('/api/admin/users/import')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('UC-3 默认是预览（不落库）', async () => {
    const { User } = models()
    const before = await User.count()

    const res = await attachUserCsv(
      `${USER_CSV_HEADER}\n,预览用户,,,812345671,+66,,1`
    )
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.validCount).toBe(1)
    expect(res.body.data.invalidCount).toBe(0)
    // 关键：预览不能写库
    expect(await User.count()).toBe(before)
  })

  it('UC-4 dry_run=false → 真的落库（强制改密标记）', async () => {
    const { User } = models()
    const res = await attachUserCsv(
      `${USER_CSV_HEADER}\n,真导入用户,,,812345672,+66,,1`,
      { dryRun: 'false' }
    )
    expect(res.status).toBe(200)
    expect(res.body.data.createdCount).toBe(1)

    const created = await User.findOne({ where: { phone: '812345672' } })
    expect(created).toBeTruthy()
    expect(created.nickname).toBe('真导入用户')
    // 新建的用户必须强制改密（运营不知道初始密码）
    expect(created.must_reset_password).toBe(true)
    // 初始密码要回传给运营（只出现一次）
    expect(res.body.data.created[0].initialPassword).toBeTruthy()
  })

  it('UC-5 strict 模式：有问题的行 → 400 且整批不落库', async () => {
    const { User } = models()
    const before = await User.count()

    const res = await attachUserCsv(
      `${USER_CSV_HEADER}\n,好用户,,,812345673,+66,,1\n,坏用户,,,abc,+66,,1`,
      { dryRun: 'false', mode: 'strict' }
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/存在问题/)
    expect(await User.count(), 'strict 模式整批不落库').toBe(before)
  })

  it('UC-6 skip 模式：坏行被跳过，好行照常导入', async () => {
    const { User } = models()
    const res = await attachUserCsv(
      `${USER_CSV_HEADER}\n,好用户,,,812345674,+66,,1\n,坏用户,,,abc,+66,,1`,
      { dryRun: 'false', mode: 'skip' }
    )
    expect(res.status).toBe(200)
    expect(res.body.data.createdCount).toBe(1)
    expect(res.body.data.skipped.length).toBe(1)
    expect(await User.count({ where: { phone: '812345674' } })).toBe(1)
  })

  it('UC-7 导出返回 CSV（带 Content-Disposition + BOM）', async () => {
    const { User } = models()
    await User.create({
      username: '+66812345675',
      nickname: '导出用户',
      phone: '812345675',
      country_code: '+66',
      password: 'Abcd1234'
    })

    const res = await request(app)
      .get('/api/admin/users/export.csv')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    expect(res.headers['content-disposition']).toMatch(/users-.*\.csv/)
    // BOM（Excel 打开中文不乱码）
    expect(res.text.charCodeAt(0)).toBe(0xFEFF)
    expect(res.text).toContain('导出用户')
    expect(res.text).toContain('nickname')
  })

  it('UC-8 导出内容能原样导回（往返）', async () => {
    const { User } = models()
    const u = await User.create({
      username: '+66812345676',
      nickname: '往返用户',
      phone: '812345676',
      country_code: '+66',
      password: 'Abcd1234'
    })

    const exported = await request(app)
      .get('/api/admin/users/export.csv')
      .set('Authorization', `Bearer ${adminToken}`)

    const res = await attachUserCsv(exported.text.replace(/^﻿/, ''), { dryRun: 'false' })
    expect(res.status).toBe(200)
    expect(res.body.data.updatedCount).toBe(1)
    expect(res.body.data.createdCount).toBe(0)

    const fresh = await User.findByPk(u.id)
    expect(fresh.nickname).toBe('往返用户')
  })

  it('UC-9 导出失败 → 500', async () => {
    const { User } = models()
    injectFault(User, 'findAll', new Error('db down'))
    const res = await request(app)
      .get('/api/admin/users/export.csv')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})

describe('合作方 CSV 导入 / 导出 接口', () => {
  it('PC-1 合作方导入落库（新建合作方 + 强制改密标记）', async () => {
    const { Partner } = models()
    const before = await Partner.count()

    const res = await attachPartnerCsv(
      `${PARTNER_CSV_HEADER}\n,new_partner_1,新合作方,dealer,15,1`,
      { dryRun: 'false' }
    )
    expect(res.status).toBe(200)
    expect(res.body.data.createdCount).toBe(1)
    expect(await Partner.count()).toBe(before + 1)

    const created = await Partner.findOne({ where: { display_name: '新合作方' } })
    expect(created).toBeTruthy()
    expect(created.must_reset_password).toBe(true)
  })

  it('PC-2 合作方导出返回 CSV', async () => {
    const { Partner } = models()
    await Partner.create({
      login: 'export_partner',
      password: 'Partner#2026',
      display_name: '导出合作方',
      is_active: true
    })

    const res = await request(app)
      .get('/api/admin/partners/export.csv')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/partners-.*\.csv/)
    expect(res.text).toContain('导出合作方')
  })

  it('PC-3 操作员没有合作方权限 → 403', async () => {
    const importRes = await attachPartnerCsv(
      `${PARTNER_CSV_HEADER}\n,overreach_partner,越权合作方,dealer,0,1`,
      { token: operatorToken, dryRun: 'false' }
    )
    expect(importRes.status).toBe(403)

    const exportRes = await request(app)
      .get('/api/admin/partners/export.csv')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(exportRes.status).toBe(403)
  })

  it('PC-4 合作方导入 strict 模式坏行 → 400', async () => {
    const { Partner } = models()
    const before = await Partner.count()
    const res = await attachPartnerCsv(
      `${PARTNER_CSV_HEADER}\n,good_partner,好合作方,dealer,0,1\n,bad_partner,坏合作方,不存在的类别,999,1`,
      { dryRun: 'false', mode: 'strict' }
    )
    expect(res.status).toBe(400)
    expect(await Partner.count(), 'strict 模式整批不落库').toBe(before)
  })
})
