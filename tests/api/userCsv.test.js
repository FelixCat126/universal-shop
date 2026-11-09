/**
 * 用户 CSV 导入 / 导出 测试
 *
 * 重点是**邀请流程**：密码不进 CSV，系统生成初始密码并强制改密。
 *
 *   UC-1 表头归一：中文表头也能认
 *   UC-2 缺必填列（昵称/手机号）→ 报错
 *   UC-3 逐行校验：手机号格式 / 区号 / 邮箱 / 重复
 *   UC-4 预览不落库
 *   UC-5 无 id → 新建；有 id → 更新
 *   UC-6 手机号已被占用 → 判错
 *   UC-7 有问题的行 → 整批不落库
 *   UC-8 新建时生成随机初始密码 + 标记 must_reset_password
 *   UC-9 初始密码真的能登录，且登录后标记为"必须改密"
 *   UC-10 更新时**不动密码**
 *   UC-11 导出含 id，可原样导回
 *   UC-12 接口：未登录 → 401；预览默认开启
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import {
  previewUserCsv,
  importUserCsv,
  exportUsersCsv,
  generateInitialPassword
} from '@server/services/userCsvService.js'

const csv = (s) => Buffer.from('﻿' + s, 'utf8')

let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `uc_admin_${Date.now()}`,
    password: 'UcPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
})

describe('用户 CSV 导入', () => {
  it('UC-1 表头归一：中文表头也能认', async () => {
    const preview = await previewUserCsv(csv([
      '昵称,手机号,国家区号,邮箱',
      '张三,13912345678,+86,zhang@example.com'
    ].join('\n')))
    expect(preview.validCount).toBe(1)
    expect(preview.valid[0].nickname).toBe('张三')
  })

  it('UC-2 缺必填列 → 报错', async () => {
    await expect(previewUserCsv(csv('昵称,邮箱\n张三,a@b.com'))).rejects.toThrow(/phone/)
  })

  it('UC-3 逐行校验：手机号格式 / 区号 / 邮箱 / 文件内重复', async () => {
    const preview = await previewUserCsv(csv([
      'nickname,phone,country_code,email',
      '好的,13912345678,+86,ok@example.com', // 全对
      '手机号不对,123,+86,a@example.com', // 手机号格式
      '区号不对,13912345679,+81,b@example.com', // 区号
      '邮箱不对,13912345680,+86,not-an-email', // 邮箱
      '重复手机,13912345678,+86,c@example.com' // 文件内手机号重复
    ].join('\n')))

    expect(preview.totalRows).toBe(5)
    expect(preview.validCount).toBe(1)
    expect(preview.invalidCount).toBe(4)
    const errors = preview.invalid.map(r => r.errors.join('|'))
    expect(errors.some(e => e.includes('手机号格式'))).toBe(true)
    expect(errors.some(e => e.includes('国家区号'))).toBe(true)
    expect(errors.some(e => e.includes('邮箱格式'))).toBe(true)
    expect(errors.some(e => e.includes('重复出现'))).toBe(true)
  })

  it('UC-4 预览不落库', async () => {
    const { User } = TestDatabase.getSequelize().models
    const before = await User.count()
    await previewUserCsv(csv('nickname,phone\n预览用户,13900001111'))
    expect(await User.count()).toBe(before)
  })

  it('UC-5 无 id → 新建；有 id → 更新', async () => {
    const { User } = TestDatabase.getSequelize().models
    const existing = await User.create(await TestDataFactory_user({
      nickname: '旧昵称', phone: '13900002222', country_code: '+86'
    }))

    const result = await importUserCsv(csv([
      'id,nickname,phone,country_code',
      `${existing.id},新昵称,13900002222,+86`,
      ',新用户,13900003333,+86'
    ].join('\n')))

    expect(result.createdCount).toBe(1)
    expect(result.updatedCount).toBe(1)
    expect(result.failedCount).toBe(0)

    const fresh = await User.findByPk(existing.id)
    expect(fresh.nickname).toBe('新昵称')
    expect(await User.count()).toBe(2)
  })

  it('UC-6 手机号已被占用 → 判错', async () => {
    const { User } = TestDatabase.getSequelize().models
    await User.create(await TestDataFactory_user({
      nickname: '已存在', phone: '13900004444', country_code: '+86'
    }))
    const preview = await previewUserCsv(csv('nickname,phone,country_code\n新用户,13900004444,+86'))
    expect(preview.validCount).toBe(0)
    expect(preview.invalidCount).toBe(1)
    expect(preview.invalid[0].errors.join('')).toMatch(/已被占用/)
  })

  it('UC-7 有问题的行 → 整批不落库', async () => {
    const { User } = TestDatabase.getSequelize().models
    const before = await User.count()
    await expect(importUserCsv(csv([
      'nickname,phone,country_code',
      '好用户,13900005555,+86',
      '坏用户,123,+86'
    ].join('\n')))).rejects.toThrow(/存在问题/)
    expect(await User.count()).toBe(before)
  })

  it('UC-8 新建时生成随机初始密码 + 标记 must_reset_password', async () => {
    const result = await importUserCsv(csv('nickname,phone,country_code\n邀请用户,13900006666,+86'))
    expect(result.createdCount).toBe(1)
    const created = result.created[0]
    expect(created.initialPassword).toBeTruthy()
    expect(created.initialPassword.length).toBe(12)

    const { User } = TestDatabase.getSequelize().models
    const user = await User.findByPk(created.id)
    // 标记为"首次登录必须改密"
    expect(user.must_reset_password).toBe(true)
    // 初始密码真的能用
    expect(await user.validatePassword(created.initialPassword)).toBe(true)
  })

  it('UC-9 初始密码能登录，登录响应带 must_reset_password 标记', async () => {
    const result = await importUserCsv(csv('nickname,phone,country_code\n登录用户,13900007777,+86'))
    const created = result.created[0]

    const login = await request(app).post('/api/users/login').send({
      country_code: '+86', phone: '13900007777', password: created.initialPassword
    })
    expect(login.status).toBe(200)
    expect(login.body.data.user.must_reset_password).toBe(true)
  })

  it('UC-10 更新时不动密码', async () => {
    const { User } = TestDatabase.getSequelize().models
    const existing = await User.create(await TestDataFactory_user({
      nickname: '原昵称', phone: '13900008888', country_code: '+86', password: 'OriginalPwd#2026'
    }))
    const before = existing.password

    const result = await importUserCsv(csv([
      'id,nickname,phone,country_code',
      `${existing.id},改了昵称,13900008888,+86`
    ].join('\n')))
    expect(result.updatedCount).toBe(1)

    const fresh = await User.findByPk(existing.id)
    expect(fresh.nickname).toBe('改了昵称')
    // 密码没被动过（运营不该碰用户的密码）
    expect(fresh.password).toBe(before)
  })

  it('UC-11 导出含 id，可原样导回', async () => {
    const { User } = TestDatabase.getSequelize().models
    const u = await User.create(await TestDataFactory_user({
      nickname: '往返用户', phone: '13900009999', country_code: '+86'
    }))

    const text = await exportUsersCsv()
    expect(text).toContain('id,nickname,username,email,phone,country_code,referral_code,is_active')
    expect(text).toContain('往返用户')

    // 导出的 CSV 逐行再解析一遍，看清楚是哪一行被判非法
    const { parseUserCsv } = await import('@server/services/userCsvService.js')
    const { rows } = await parseUserCsv(Buffer.from(text, 'utf8'))
    console.log('导出的行:', JSON.stringify(rows.map(r => r.cells)))
    console.log('CSV 原文:', JSON.stringify(text))

    const result = await importUserCsv(Buffer.from(text, 'utf8'))
    expect(result.updatedCount).toBe(1)
    expect(result.createdCount).toBe(0)
  })

  it('UC-12 接口：未登录 → 401；预览默认开启', async () => {
    const unauth = await request(app).post('/api/admin/users/import')
    expect([401, 403]).toContain(unauth.status)

    const { User } = TestDatabase.getSequelize().models
    const before = await User.count()
    const res = await request(app)
      .post('/api/admin/users/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('﻿nickname,phone,country_code\n接口用户,13900001000,+86', 'utf8'), {
        filename: 'users.csv',
        contentType: 'text/csv'
      })
    expect(res.status).toBe(200)
    expect(res.body.data.validCount).toBe(1)
    expect(await User.count()).toBe(before)
  })

  it('UC-14 改完密码 → must_reset_password 标记清掉（不再被要求改密）', async () => {
    const result = await importUserCsv(csv('nickname,phone,country_code\n改密用户,13900001111,+86'))
    const created = result.created[0]

    const { User } = TestDatabase.getSequelize().models
    const before = await User.findByPk(created.id)
    expect(before.must_reset_password).toBe(true)

    // 用**这个用户自己的** token（管理员 token 不行）
    const login = await request(app).post('/api/users/login').send({
      country_code: '+86', phone: '13900001111', password: created.initialPassword
    })
    expect(login.status).toBe(200)
    const userToken = login.body.data.token

    const res = await request(app)
      .put('/api/users/profile/password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ old_password: created.initialPassword, new_password: 'BrandNewPwd#2026' })
    expect(res.status).toBe(200)

    const after = await User.findByPk(created.id)
    expect(after.must_reset_password).toBe(false)
    expect(await after.validatePassword('BrandNewPwd#2026')).toBe(true)
  })

  it('UC-13 随机初始密码：长度与字符集', () => {
    for (let i = 0; i < 20; i++) {
      const pwd = generateInitialPassword()
      expect(pwd.length).toBe(12)
      expect(pwd).toMatch(/[A-Z]/)
      expect(pwd).toMatch(/[a-z]/)
      expect(pwd).toMatch(/[0-9]/)
      expect(pwd).toMatch(/[!@#$%&*]/)
      // 不含易混字符（这密码要线下口头告知，敲错很常见）
      expect(pwd).not.toMatch(/[0O1lI]/)
    }
  })
})

/** 造一个用户（密码会被模型 hook 加密） */
async function TestDataFactory_user (overrides = {}) {
  const { TestDataFactory } = await import('../factories/index.js')
  return TestDataFactory.createUser({
    nickname: '测试用户',
    country_code: '+86',
    phone: '13900000000',
    ...overrides
  })
}
