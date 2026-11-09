/**
 * 合作方 CSV 导入 / 导出 测试
 *
 *   PCV-1 表头归一：中文表头也能认
 *   PCV-2 缺必填列（登录名）→ 报错
 *   PCV-3 逐行校验：登录名格式 / 账号类别 / 折扣范围 / 启用状态
 *   PCV-4 预览不落库
 *   PCV-5 无 id → 新建；有 id → 更新
 *   PCV-6 登录名已被占用 → 判错
 *   PCV-7 文件内登录名/id 重复 → 判错
 *   PCV-8 有问题的行 → 整批不落库
 *   PCV-9 新建时生成随机初始密码（不在 CSV 里明文）
 *   PCV-10 导出含 id，可原样导回
 *   PCV-11 接口：未登录 → 401
 *   PCV-12 接口：预览默认开启
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import {
  previewPartnerCsv,
  importPartnerCsv,
  exportPartnersCsv
} from '@server/services/partnerCsvService.js'

const csv = (s) => Buffer.from('﻿' + s, 'utf8')

let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `pcv_admin_${Date.now()}`,
    password: 'PcvPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
})

describe('合作方 CSV 导入', () => {
  it('PCV-1 表头归一：中文表头也能认', async () => {
    const preview = await previewPartnerCsv(csv([
      '登录名,商家名称,账号类别,折扣',
      'shop_a,店铺A,dealer,15'
    ].join('\n')))
    expect(preview.validCount).toBe(1)
    expect(preview.valid[0].login).toBe('shop_a')
    expect(preview.valid[0].account_kind).toBe('dealer')
    expect(preview.valid[0].discount_percent).toBe(15)
  })

  it('PCV-2 缺必填列（登录名）→ 报错', async () => {
    await expect(previewPartnerCsv(csv('商家名称,折扣\n店铺A,10'))).rejects.toThrow(/login/)
  })

  it('PCV-3 逐行校验：登录名格式 / 账号类别 / 折扣 / 启用状态', async () => {
    const preview = await previewPartnerCsv(csv([
      'login,display_name,account_kind,discount_percent,is_active',
      'good_shop,好店,dealer,10,true', // 全对
      'bad login!,非法字符,dealer,10,true', // 登录名字符非法
      'shop_b,店B,unknown_kind,10,true', // 账号类别非法
      'shop_c,店C,dealer,150,true', // 折扣超范围
      'shop_d,店D,dealer,10,maybe' // 启用状态认不出
    ].join('\n')))

    expect(preview.totalRows).toBe(5)
    expect(preview.validCount).toBe(1)
    expect(preview.invalidCount).toBe(4)
    const errors = preview.invalid.map(r => r.errors.join('|'))
    expect(errors.some(e => e.includes('登录名'))).toBe(true)
    expect(errors.some(e => e.includes('账号类别'))).toBe(true)
    expect(errors.some(e => e.includes('折扣'))).toBe(true)
    expect(errors.some(e => e.includes('启用状态'))).toBe(true)
  })

  it('PCV-4 预览不落库', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    const before = await Partner.count()
    await previewPartnerCsv(csv('login,display_name\nshop_preview,预览店铺'))
    expect(await Partner.count()).toBe(before)
  })

  it('PCV-5 无 id → 新建；有 id → 更新', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    const existing = await Partner.create({
      login: 'shop_old', password: 'OldPwd#2026', display_name: '旧名称',
      account_kind: 'dealer', discount_percent: 5, is_active: true
    })

    const result = await importPartnerCsv(csv([
      'id,login,display_name,account_kind,discount_percent',
      `${existing.id},shop_old,新名称,agent,20`,
      ',shop_new,新店铺,dealer,10'
    ].join('\n')))

    expect(result.createdCount).toBe(1)
    expect(result.updatedCount).toBe(1)
    expect(result.failedCount).toBe(0)

    const fresh = await Partner.findByPk(existing.id)
    expect(fresh.display_name).toBe('新名称')
    expect(fresh.account_kind).toBe('agent')
    expect(Number(fresh.discount_percent)).toBe(20)
    expect(await Partner.count()).toBe(2)
  })

  it('PCV-6 登录名已被占用 → 判错', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    await Partner.create({
      login: 'shop_taken', password: 'TakenPwd#2026', account_kind: 'dealer',
      discount_percent: 0, is_active: true
    })
    const preview = await previewPartnerCsv(csv('login,display_name\nshop_taken,重复店铺'))
    expect(preview.validCount).toBe(0)
    expect(preview.invalidCount).toBe(1)
    expect(preview.invalid[0].errors.join('')).toMatch(/已被占用/)
  })

  it('PCV-7 文件内登录名/id 重复 → 判错', async () => {
    const preview = await previewPartnerCsv(csv([
      'login,display_name',
      'dup_shop,店铺一',
      'dup_shop,店铺二'
    ].join('\n')))
    expect(preview.invalidCount).toBe(1)
    expect(preview.invalid[0].errors.join('')).toMatch(/重复/)
  })

  it('PCV-8 有问题的行 → 整批不落库', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    const before = await Partner.count()
    await expect(importPartnerCsv(csv([
      'login,display_name,discount_percent',
      'good_shop,好店,10',
      'bad_shop!,坏店,10'
    ].join('\n')))).rejects.toThrow(/存在问题/)
    expect(await Partner.count()).toBe(before)
  })

  it('PCV-9 新建时生成随机初始密码（不在 CSV 里明文）', async () => {
    const result = await importPartnerCsv(csv('login,display_name\nshop_pwd,带密码店铺'))
    expect(result.createdCount).toBe(1)
    const created = result.created[0]
    // 初始密码是随机生成的，且只在这里出现
    expect(created.initialPassword).toBeTruthy()
    expect(created.initialPassword.length).toBe(12)
    // 不能是 CSV 里写的明文
    expect(created.initialPassword).not.toBe('shop_pwd')

    // 且这个密码真的能登录
    const { Partner } = TestDatabase.getSequelize().models
    const partner = await Partner.findByPk(created.id)
    expect(await partner.validatePassword(created.initialPassword)).toBe(true)
  })

  it('PCV-10 导出含 id，可原样导回', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    const p = await Partner.create({
      login: 'shop_rt', password: 'RtPwd#2026', display_name: '往返店铺',
      account_kind: 'dealer', discount_percent: 12, is_active: true
    })

    const text = await exportPartnersCsv()
    expect(text).toContain('id,login,display_name,account_kind,discount_percent,is_active')
    expect(text).toContain('shop_rt')

    // 原样导回去 → 变成"更新"，且不改任何字段
    const result = await importPartnerCsv(Buffer.from(text, 'utf8'))
    expect(result.updatedCount).toBe(1)
    expect(result.createdCount).toBe(0)

    const fresh = await Partner.findByPk(p.id)
    expect(fresh.display_name).toBe('往返店铺')
    expect(Number(fresh.discount_percent)).toBe(12)
  })
})

describe('合作方 CSV 接口', () => {
  it('PCV-11 未登录 → 401', async () => {
    const res = await request(app).post('/api/admin/partners/import')
    expect([401, 403]).toContain(res.status)
  })

  it('PCV-12 预览默认开启（不落库）', async () => {
    const { Partner } = TestDatabase.getSequelize().models
    const before = await Partner.count()

    const res = await request(app)
      .post('/api/admin/partners/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('﻿login,display_name\nshop_api,接口店铺', 'utf8'), {
        filename: 'partners.csv',
        contentType: 'text/csv'
      })
    expect(res.status).toBe(200)
    expect(res.body.data.validCount).toBe(1)
    expect(await Partner.count()).toBe(before)
  })
})
