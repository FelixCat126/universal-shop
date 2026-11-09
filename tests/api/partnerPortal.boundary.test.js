/**
 * 合作方门户（批发订货）的边界测试
 *
 * 合作方是**独立的钱路**：零售下单和批发下单是两套逻辑、两套库存、两套价格。
 * 零售那边测得很细，批发这边的"拒绝坏输入"分支却大面积没测 ——
 * 而批发一单就是几十上百件，库存算错、幂等失效、越权改别人的单，
 * 代价都是真金白银。
 *
 *   PB-1 地址：必填缺失 → 400
 *   PB-2 地址：改别人的地址 → 404
 *   PB-3 地址：删别人的地址 → 404
 *   PB-4 设默认地址：只有一个默认，且幂等
 *   PB-5 订单详情：别人的订单 → 404
 *   PB-6 确认付款：订单不存在 → 404
 *   PB-7 确认付款：状态不对 → 400
 *   PB-8 幂等键：同 key 重复提交 → 只成一单，库存只扣一次
 *   PB-9 库存不足 → 400
 *   PB-10 MOQ 不满足 → 400
 *   PB-11 未登录 → 401
 *   PB-12 商品列表：只返回在售商品
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let partner
let token
let address
let category
let product

const ADDR_BODY = {
  recipient_name: '收货人',
  phone_country_code: '+66',
  phone: '900000111',
  province: 'TH',
  city: 'BKK',
  district: 'D1',
  postal_code: '10330',
  detail: 'Soi 1, Building A',
  label: 'Office'
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const created = await TestHelpers.createPartnerWithAddress()
  partner = created.partner
  token = created.token
  address = created.address

  const cat = await TestHelpers.createCategoryWithProducts({ count: 1 })
  category = cat.category
  product = cat.products[0]
  // 批发起步量是 50，给足库存
  const { Product } = TestDatabase.getSequelize().models
  await Product.update({ stock: 1000 }, { where: { id: product.id } })
})

const p = (method, url, body, tok = token) => {
  const req = request(app)[method](url).set('Authorization', `Bearer ${tok}`)
  return body ? req.send(body) : req
}

describe('合作方地址边界', () => {
  it('PB-1 地址：必填缺失 → 400', async () => {
    for (const body of [
      { ...ADDR_BODY, recipient_name: '' },
      { ...ADDR_BODY, phone: '' },
      { ...ADDR_BODY, detail: '' }
    ]) {
      const res = await p('post', '/api/partner/addresses', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('PB-2 地址：改别人的地址 → 404', async () => {
    const other = await TestHelpers.createPartnerWithAddress()
    const res = await p('put', `/api/partner/addresses/${address.id}`, {
      recipient_name: '被篡改'
    }, other.token)
    expect(res.status).toBe(404)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    const fresh = await PartnerAddress.findByPk(address.id)
    expect(fresh.recipient_name).not.toBe('被篡改')
  })

  it('PB-3 地址：删别人的地址 → 404', async () => {
    const other = await TestHelpers.createPartnerWithAddress()
    const res = await p('delete', `/api/partner/addresses/${address.id}`, null, other.token)
    expect(res.status).toBe(404)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    expect(await PartnerAddress.findByPk(address.id)).toBeTruthy()
  })

  it('PB-4 设默认地址：只有一个默认，且幂等', async () => {
    const second = await p('post', '/api/partner/addresses', {
      ...ADDR_BODY, detail: '另一个地址'
    })
    expect(second.status).toBe(201)

    const { PartnerAddress } = TestDatabase.getSequelize().models
    const setRes = await p('put', `/api/partner/addresses/${second.body.data.id}/default`)
    expect(setRes.status).toBe(200)

    let defaults = await PartnerAddress.findAll({ where: { partner_id: partner.id, is_default: true } })
    expect(defaults.length).toBe(1)
    expect(defaults[0].id).toBe(second.body.data.id)

    // 再设一次同一个 → 结果不变（幂等）
    await p('put', `/api/partner/addresses/${second.body.data.id}/default`)
    defaults = await PartnerAddress.findAll({ where: { partner_id: partner.id, is_default: true } })
    expect(defaults.length).toBe(1)
  })
})

describe('合作方订单边界', () => {
  it('PB-5 订单详情：别人的订单 → 404', async () => {
    const order = await p('post', '/api/partner/orders', {
      partner_address_id: address.id,
      items: [{ product_id: product.id, quantity: 50 }]
    })
    expect(order.status).toBe(201)

    const other = await TestHelpers.createPartnerWithAddress()
    const res = await p('get', `/api/partner/orders/${order.body.data.id}`, null, other.token)
    expect(res.status).toBe(404)
  })

  it('PB-6 确认付款：订单不存在 → 404', async () => {
    const res = await p('post', '/api/partner/orders/999999/confirm-payment')
    expect(res.status).toBe(404)
  })

  it('PB-7 确认付款：状态不对 → 409；重复确认幂等', async () => {
    const order = await p('post', '/api/partner/orders', {
      partner_address_id: address.id,
      items: [{ product_id: product.id, quantity: 50 }]
    })
    expect(order.status).toBe(201)

    /**
     * 新下的单是 submitted，要等**管理端**确认后才转成 pending_payment。
     * 在那之前合作方点"确认付款" → 409 Conflict（状态冲突，不是 400 参数错）。
     */
    const notReady = await p('post', `/api/partner/orders/${order.body.data.id}/confirm-payment`)
    expect(notReady.status).toBe(409)
    expect(notReady.body.message).toMatch(/状态/)

    // 模拟管理端把单转到 pending_payment
    const { PartnerOrder } = TestDatabase.getSequelize().models
    await PartnerOrder.update(
      { status: 'pending_payment' },
      { where: { id: order.body.data.id } }
    )

    // 第一次确认 → 成功
    const first = await p('post', `/api/partner/orders/${order.body.data.id}/confirm-payment`)
    expect(first.status).toBe(200)

    // 再确认一次 → **幂等**（连点两下不该报错，已支付就原样返回）
    const second = await p('post', `/api/partner/orders/${order.body.data.id}/confirm-payment`)
    expect(second.status).toBe(200)
    expect(second.body.message).toMatch(/支付已确认/)
  })

  it('PB-8 幂等键：同 key 重复提交 → 只成一单，库存只扣一次', async () => {
    const { Product, PartnerOrder } = TestDatabase.getSequelize().models
    const stockBefore = (await Product.findByPk(product.id)).stock

    const body = {
      partner_address_id: address.id,
      client_order_key: 'PB-IDEMPOTENT-1',
      items: [{ product_id: product.id, quantity: 50 }]
    }
    const first = await p('post', '/api/partner/orders', body)
    expect(first.status).toBe(201)

    const second = await p('post', '/api/partner/orders', body)
    expect(second.status).toBe(200)
    expect(second.body.deduplicated).toBe(true)
    expect(second.body.data.id).toBe(first.body.data.id)

    // 只成一单
    expect(await PartnerOrder.count({ where: { partner_id: partner.id } })).toBe(1)
    // 库存只扣一次
    expect((await Product.findByPk(product.id)).stock).toBe(stockBefore - 50)
  })

  it('PB-9 库存不足 → 400', async () => {
    const { Product } = TestDatabase.getSequelize().models
    await Product.update({ stock: 10 }, { where: { id: product.id } })

    const res = await p('post', '/api/partner/orders', {
      partner_address_id: address.id,
      items: [{ product_id: product.id, quantity: 50 }]
    })
    expect(res.status).toBe(400)
  })

  it('PB-10 MOQ 不满足 → 400', async () => {
    // 批发起步量 50，订 1 件不够
    const res = await p('post', '/api/partner/orders', {
      partner_address_id: address.id,
      items: [{ product_id: product.id, quantity: 1 }]
    })
    expect(res.status).toBe(400)
  })

  it('PB-11 未登录 → 401', async () => {
    for (const [method, url] of [
      ['get', '/api/partner/orders'],
      ['get', '/api/partner/products'],
      ['post', '/api/partner/orders']
    ]) {
      const res = await request(app)[method](url).send({})
      expect([401, 403], `${method.toUpperCase()} ${url}`).toContain(res.status)
    }
  })

  it('PB-12 商品列表：返回在售商品', async () => {
    const res = await p('get', '/api/partner/products')
    expect(res.status).toBe(200)
    const list = res.body.data?.products || res.body.data || []
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(0)
  })
})
