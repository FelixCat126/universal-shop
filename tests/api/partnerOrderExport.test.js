/**
 * 合作方订单导出（CSV / xlsx）测试
 *
 * 批发对账是**成批**的（一次几百单、上万行），财务的工具链要的是 CSV。
 * 之前只有 xlsx —— 财务还得手工再转一次。
 *
 *   PO-1 format=csv → Content-Type 是 text/csv，文件名是 .csv
 *   PO-2 CSV 内容：表头 + 每行一个商品行
 *   PO-3 CSV 带 BOM（Excel 打开中文不乱码）
 *   PO-4 默认仍是 xlsx（不破坏原行为）
 *   PO-5 状态筛选生效
 *   PO-6 异步导出任务支持 partner_orders 类型
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `poe_admin_${Date.now()}`,
    password: 'PoePwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
})

/** 造一个合作方订单（带商品行） */
async function makeOrder (status = 'submitted', productName = '批发商品') {
  const { Partner, PartnerOrder, PartnerOrderItem, Product } = TestDatabase.getSequelize().models
  const partner = await Partner.create({
    login: `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    password: 'PartnerPwd#2026',
    display_name: '对账合作方',
    account_kind: 'dealer',
    discount_percent: 10,
    is_active: true
  })
  const product = await Product.create({
    name: productName, price: 100, stock: 1000, status: 'active'
  })
  const order = await PartnerOrder.create({
    partner_id: partner.id,
    order_no: `PO${Date.now()}${Math.floor(Math.random() * 1000)}`,
    status,
    contact_name: '收货人',
    contact_phone: '0812345678',
    delivery_address: '曼谷\n某路 1 号',
    total_amount: 200,
    total_amount_thb: 200,
    currency_code: 'THB',
    payment_method: 'cod'
  })
  await PartnerOrderItem.create({
    partner_order_id: order.id,
    product_id: product.id,
    quantity: 2,
    base_unit_thb: 100,
    unit_price_thb: 90,
    line_total_thb: 180,
    partner_discount_percent_snapshot: 10,
    product_name_snapshot: productName,
    product_image_snapshot: '/uploads/products/x.png'
  })
  return { partner, order }
}

describe('合作方订单导出', () => {
  it('PO-1 format=csv → Content-Type 与文件名正确', async () => {
    await makeOrder()
    const res = await request(app)
      .get('/api/admin/partner-orders/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/\.csv/)
  })

  it('PO-2 CSV 内容：表头 + 每个商品行一行', async () => {
    await makeOrder('submitted', '测试批发商品')
    const res = await request(app)
      .get('/api/admin/partner-orders/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
    const text = res.text.replace(/^﻿/, '')
    const lines = text.split('\r\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[0]).toContain('订单号')
    expect(lines[0]).toContain('合作方登录名')
    expect(lines[0]).toContain('行小计THB')
    // 数据行里能看到商品名与数量
    expect(text).toContain('测试批发商品')
    expect(text).toContain('对账合作方')
  })

  it('PO-3 CSV 带 BOM（Excel 打开中文不乱码）', async () => {
    await makeOrder()
    const res = await request(app)
      .get('/api/admin/partner-orders/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
    // supertest 会把 utf8 解码成字符串，BOM 会变成 \uFEFF
    expect(res.text.charCodeAt(0)).toBe(0xfeff)
  })

  it('PO-4 默认仍是 xlsx（不破坏原行为）', async () => {
    await makeOrder()
    const res = await request(app)
      .get('/api/admin/partner-orders/export')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheetml/)
    expect(res.headers['content-disposition']).toMatch(/\.xlsx/)
  })

  it('PO-5 状态筛选生效', async () => {
    await makeOrder('submitted')
    await makeOrder('cancelled')
    const all = await request(app)
      .get('/api/admin/partner-orders/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
    const one = await request(app)
      .get('/api/admin/partner-orders/export?format=csv&status=cancelled')
      .set('Authorization', `Bearer ${token}`)
    const countLines = (t) => t.replace(/^﻿/, '').split('\r\n').filter(Boolean).length
    expect(countLines(one.text)).toBeLessThan(countLines(all.text))
  })

  it('PO-6 异步导出任务支持 partner_orders 类型', async () => {
    const res = await request(app)
      .post('/api/admin/export/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'partner_orders', format: 'csv' })
    expect(res.status).toBe(201)
    expect(res.body.data.job.type).toBe('partner_orders')
    expect(res.body.data.job.params.format).toBe('csv')
  })
})
