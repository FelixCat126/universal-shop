/**
 * CSV 导入的三条"静默毁数据"回归
 *
 * 这三条都是**不报错、不提示、直接改坏库**的故障，运营完全察觉不到：
 *
 * 1. 解析器做类型推断 → 手机号 "0812345678" 变成 812345678（前导零丢）、
 *    用户名 "+66812345678" 变成 66812345678（加号丢）、
 *    推荐码 "01234567" 变成 1234567（推荐关系错）、
 *    日期样式文本 "2024-01-05" 变成 null（描述被清空）
 * 2. 更新分支把"CSV 里没有的列"用缺省值写回 → 删掉 stock 列导回，
 *    **所有商品库存被清零**；删掉 is_active 列 → **被停用的用户/合作方被重新启用**
 * 3. skip 模式下预览判为"有问题"的行**照样落库** → 同一 id 在文件里出现两次时，
 *    后者把前者静默覆盖，报告却说"已跳过"
 *
 *   CS-1 手机号前导零保留
 *   CS-2 用户名加号保留
 *   CS-3 推荐码前导零保留
 *   CS-4 日期样式文本不被置空
 *   CS-5 商品：CSV 缺 stock 列 → 库存不被清零
 *   CS-6 合作方：CSV 缺 is_active/discount_percent 列 → 停用状态与折扣不被抹掉
 *   CS-7 用户：CSV 缺 is_active 列 → 停用状态不被改回
 *   CS-8 skip 模式：文件内重复 id → 后者不覆盖前者，且被报告为"跳过"
 *   CS-9 失败行不被重复计数
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
})

/** 上传 CSV（用户） */
function attachUserCsv (content, fields = {}) {
  let req = request(app)
    .post('/api/admin/users/import')
    .set('Authorization', `Bearer ${adminToken}`)
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename: 'users.csv',
    contentType: 'text/csv'
  })
}

/** 上传 CSV（合作方） */
function attachPartnerCsv (content, fields = {}) {
  let req = request(app)
    .post('/api/admin/partners/import')
    .set('Authorization', `Bearer ${adminToken}`)
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename: 'partners.csv',
    contentType: 'text/csv'
  })
}

/** 上传 CSV（商品） */
function attachProductCsv (content, fields = {}) {
  let req = request(app)
    .post('/api/products/import')
    .set('Authorization', `Bearer ${adminToken}`)
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename: 'products.csv',
    contentType: 'text/csv'
  })
}

describe('CSV 导入：不静默改坏数据', () => {
  it('CS-1 手机号前导零不会被静默吞掉', async () => {
    const csv = [
      'id,nickname,username,email,phone,country_code,referral_code,is_active',
      ',带前导零,,x@example.com,0812345678,+66,,true'
    ].join('\n')
    const res = await attachUserCsv(csv, { dry_run: 'false' })

    /**
     * 手机号本身不允许前导零（校验规则 ^[1-9]\d{7,15}$），
     * 所以正确行为是**明确报格式错**；
     * 之前解析器把前导零吞掉 → 变成 812345678（另一个合法号码）→
     * 要么导成了别人的号，要么报"已被占用"，运营完全看不懂发生了什么。
     */
    expect(res.status).toBe(400)
    // strict 模式是聚合报错，具体原因在 preview 里（errors 数组）
    const errors = res.body.data?.invalid?.[0]?.errors || []
    expect(errors.join('；'), `报错原因应指出手机号格式：${JSON.stringify(res.body.data)}`).toMatch(/手机号/)
    // 并且原值被原样保留（没被解析器改写）
    expect(res.body.data.invalid[0].phone).toBe('0812345678')

    const { User } = models()
    expect(await User.count({ where: { nickname: '带前导零' } })).toBe(0)
  })

  it('CS-2 用户名加号保留', async () => {
    const csv = [
      'id,nickname,username,email,phone,country_code,referral_code,is_active',
      ',带加号,+66812345678,x@example.com,812345678,+66,,true'
    ].join('\n')
    const res = await attachUserCsv(csv, { dry_run: 'false' })
    expect(res.status).toBe(200)

    const { User } = models()
    const created = await User.findOne({ where: { nickname: '带加号' } })
    expect(created.username, '加号不能丢（系统约定 country_code+phone）').toBe('+66812345678')
  })

  it('CS-3 推荐码前导零保留', async () => {
    const csv = [
      'id,nickname,username,email,phone,country_code,referral_code,is_active',
      ',带推荐码,,x@example.com,812345678,+66,01234567,true'
    ].join('\n')
    const res = await attachUserCsv(csv, { dry_run: 'false' })
    expect(res.status).toBe(200)

    const { User } = models()
    const created = await User.findOne({ where: { nickname: '带推荐码' } })
    expect(created.referral_code, '推荐码前导零不能丢（否则推荐关系错）').toBe('01234567')
  })

  it('CS-4 日期样式文本不被置空', async () => {
    const csv = [
      'id,nickname,username,email,phone,country_code,referral_code,is_active',
      ',日期名,,2024-01-05@example.com,812345678,+66,,true'
    ].join('\n')
    const res = await attachUserCsv(csv, { dry_run: 'false' })
    expect(res.status).toBe(200)

    const { User } = models()
    const created = await User.findOne({ where: { nickname: '日期名' } })
    expect(created.email, '日期样式文本不能被整格置空').toBe('2024-01-05@example.com')
  })

  it('CS-5 商品：CSV 缺 stock 列 → 库存不被清零', async () => {
    const { Product } = models()
    const p = await Product.create({
      name: '原商品', price: 50, stock: 123, points: 7, status: 'active'
    })

    // CSV 里只有 id/name/price —— 没有 stock
    const csv = [
      'id,name,price',
      `${p.id},改名后的商品,60`
    ].join('\n')
    const res = await attachProductCsv(csv, { dry_run: 'false' })
    expect(res.status).toBe(200)

    const fresh = await Product.findByPk(p.id)
    expect(fresh.name).toBe('改名后的商品')
    expect(Number(fresh.stock), 'CSV 里没有 stock 列 → 库存不该被清零').toBe(123)
    expect(Number(fresh.points), 'CSV 里没有 points 列 → 积分不该被清零').toBe(7)
  })

  it('CS-6 合作方：CSV 缺 is_active/discount_percent 列 → 停用状态与折扣不被抹掉', async () => {
    const { Partner } = models()
    const partner = await Partner.create({
      login: 'stopped_shop',
      password: 'Partner#2026',
      display_name: '已停用店铺',
      discount_percent: 25,
      is_active: false,
      account_kind: 'agent'
    })

    const csv = [
      'id,login,display_name',
      `${partner.id},stopped_shop,改个名`
    ].join('\n')
    const res = await attachPartnerCsv(csv, { dry_run: 'false' })
    expect(res.status).toBe(200)

    const fresh = await Partner.findByPk(partner.id)
    expect(fresh.display_name).toBe('改个名')
    expect(fresh.is_active, 'CSV 里没有 is_active 列 → 停用状态不该被改回启用').toBe(false)
    expect(Number(fresh.discount_percent), 'CSV 里没有 discount_percent 列 → 折扣不该被抹成 0').toBe(25)
    expect(fresh.account_kind, 'CSV 里没有 account_kind 列 → 类别不该被改回 dealer').toBe('agent')
  })

  it('CS-7 用户：CSV 缺 is_active 列 → 停用状态不被改回', async () => {
    const { User } = models()
    const u = await User.create({
      username: 'disabled_user',
      nickname: '已停用客户',
      phone: '812345679',
      country_code: '+66',
      password: 'Abcd1234',
      is_active: false
    })

    const csv = [
      'id,nickname,phone,country_code',
      `${u.id},改名客户,812345679,+66`
    ].join('\n')
    const res = await attachUserCsv(csv, { dry_run: 'false' })
    expect(res.status).toBe(200)

    const fresh = await User.findByPk(u.id)
    expect(fresh.nickname).toBe('改名客户')
    expect(fresh.is_active, 'CSV 里没有 is_active 列 → 停用状态不该被改回启用').toBe(false)
  })

  it('CS-8 skip 模式：文件内重复 id → 后者不覆盖前者', async () => {
    const { Product } = models()
    const p = await Product.create({
      name: '原始商品', price: 50, stock: 10, status: 'active'
    })

    const csv = [
      'id,name,price,stock',
      `${p.id},商品A,10,5`,
      `${p.id},商品B,20,9`
    ].join('\n')
    const res = await attachProductCsv(csv, { dry_run: 'false', mode: 'skip' })
    expect(res.status).toBe(200)

    const fresh = await Product.findByPk(p.id)
    expect(fresh.name, '重复 id 的后者不该覆盖前者').toBe('商品A')
    expect(Number(fresh.price)).toBe(10)
    // 且这行被报告为"跳过"
    expect(res.body.data.skipped.length).toBeGreaterThan(0)
  })

  it('CS-9 失败行不被重复计数', async () => {
    const csv = [
      'id,nickname,username,email,phone,country_code,referral_code,is_active',
      ',好用户,,x@example.com,812345678,+66,,true',
      ',坏用户,,y@example.com,abc,+66,,true'
    ].join('\n')
    const res = await attachUserCsv(csv, { dry_run: 'false', mode: 'skip' })
    expect(res.status).toBe(200)

    const d = res.body.data
    // 1 行坏数据：真实失败 1 行，报告里也只该算 1 行（不是 2）
    expect(d.failedCount, `失败数被重复计数：${JSON.stringify(d)}`).toBe(1)
    expect(d.skipped.length).toBe(1)
    expect(d.failed.length).toBe(0)
  })
})
