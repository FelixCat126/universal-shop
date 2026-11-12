/**
 * 「导出 → 改 → 导回」必须闭环
 *
 * 运营的真实工作流：导出商品/合作方/用户 CSV → 在 Excel 里改几项 → 导回。
 * 这条链路断在哪儿，运营就得出错：导回报"缺少必填列"、或者某一列**悄悄被写成默认值**。
 *
 * 之前断在两处（异步导出任务用的是中文表头，导入的别名表里没有）：
 *   - 商品导出表头 '售价THB' 不在 price 的别名里 → 导回直接 400「缺少必填列：price」
 *   - 合作方导出表头 '折扣%' 不在 discount_percent 的别名里 → 该列不被识别，
 *     缺省值 0 → **合作方的折扣被写成 0**（比报错更糟：悄无声息地改坏数据）
 *
 *   RT-1 商品导出表头 → 导回成功，字段正确
 *   RT-2 合作方导出表头 → 导回成功，折扣不被抹成 0
 *   RT-3 用户导出表头 → 导回成功
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

function attach (url, content, filename, fields = {}) {
  let req = request(app).post(url).set('Authorization', `Bearer ${adminToken}`)
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename,
    contentType: 'text/csv'
  })
}

describe('导出→改→导回 闭环', () => {
  it('RT-1 商品：导出任务的中文表头能原样导回', async () => {
    const { Product, ProductCategory } = models()
    const cat = await ProductCategory.create({ name: '导出闭环分类' })
    const p = await Product.create({
      name: '导出闭环商品', price: 50, stock: 20, points: 3,
      category_id: cat.id, status: 'active'
    })

    // 与 exportJobService 的 PRODUCT_EXPORT_HEADERS 完全一致
    const csv = [
      'ID,名称,泰文名,分类,售价THB,库存,积分,状态,创建时间',
      `${p.id},导出闭环商品,,导出闭环分类,88,20,3,active,2026-01-01`
    ].join('\n')

    const res = await attach('/api/products/import', csv, 'products.csv', { dry_run: 'false' })
    expect(res.status, `导回应成功：${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body.data.updatedCount).toBe(1)

    const fresh = await Product.findByPk(p.id)
    expect(fresh.name).toBe('导出闭环商品')
    expect(Number(fresh.price), '售价THB 必须被认出来').toBe(88)
    expect(Number(fresh.stock)).toBe(20)
  })

  it('RT-2 合作方：导出任务的中文表头能原样导回，折扣不被抹成 0', async () => {
    const { Partner } = models()
    const partner = await Partner.create({
      login: 'roundtrip_shop',
      password: 'Partner#2026',
      display_name: '往返合作方',
      account_kind: 'dealer',
      discount_percent: 25,
      is_active: true
    })

    // 与 exportJobService 的 PARTNER_EXPORT_HEADERS 完全一致
    const csv = [
      'ID,登录名,商家名称,账号类别,折扣%,启用,最后登录,创建时间',
      `${partner.id},roundtrip_shop,改名后的店铺,dealer,30,true,,2026-01-01`
    ].join('\n')

    const res = await attach('/api/admin/partners/import', csv, 'partners.csv', { dry_run: 'false' })
    expect(res.status, `导回应成功：${JSON.stringify(res.body)}`).toBe(200)

    const fresh = await Partner.findByPk(partner.id)
    expect(fresh.display_name).toBe('改名后的店铺')
    expect(Number(fresh.discount_percent), '折扣% 必须被认出来（否则被抹成 0）').toBe(30)
  })

  it('RT-3 用户：导出任务的中文表头能原样导回', async () => {
    const { User } = models()
    const u = await User.create({
      username: 'roundtrip_user',
      nickname: '往返用户',
      phone: '812345680',
      country_code: '+66',
      password: 'Abcd1234',
      is_active: true
    })

    // 与 exportJobService 的 USER_EXPORT_HEADERS 完全一致
    const csv = [
      'ID,用户名,昵称,邮箱,手机号,推荐码,被推荐码,注册时间,更新时间',
      `${u.id},roundtrip_user,改名用户,x@example.com,812345680,ABC123,,2026-01-01,2026-01-01`
    ].join('\n')

    const res = await attach('/api/admin/users/import', csv, 'users.csv', { dry_run: 'false' })
    expect(res.status, `导回应成功：${JSON.stringify(res.body)}`).toBe(200)

    const fresh = await User.findByPk(u.id)
    expect(fresh.nickname).toBe('改名用户')
    expect(fresh.referral_code).toBe('ABC123')
  })
})
