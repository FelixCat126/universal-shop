/**
 * 定价引擎边界专项（9 用例）
 *
 * 覆盖第一轮深度审计发现并修复的定价/券/金额边界：
 *   PB-1  限定范围券（指定商品/分类）在购物车无适用商品时必须拒绝
 *   PB-2  限定范围券的抵扣额只能落在适用商品上，不得溢出到范围外
 *   PB-3  限定范围券的抵扣额上限 = 适用商品满减后应付
 *   PB-4  券分摊后任何一行的 discount_allocated 不得为负
 *   PB-5  单品直降价用整数分计算，不得少 1 分
 *   PB-6  订单金额超过 DECIMAL(10,2) 上限时返回 400 而非 500
 *   PB-7  组合包展开行数量不套用单品 5000 上限
 *   PB-8  金额守恒：items_total - discount_amount === payable_thb
 *   PB-9  券抵扣后 payable_thb 不得为负
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { priceOrder } from '@server/services/pricingEngine.js'


const models = () => TestDatabase.getSequelize().models

let cat
let productA
let productB

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { ProductCategory: PC, Product: P } = models()
  cat = await PC.create({ name: 'cat-' + Date.now(), sort_order: 1 })
  productA = await P.create({
    name: 'A商品', price: 100, stock: 1000, category_id: cat.id, status: 'active'
  })
  productB = await P.create({
    name: 'B商品', price: 1000, stock: 1000, category_id: cat.id, status: 'active'
  })
})

async function makeCoupon (overrides = {}) {
  const { CouponTemplate: CT } = models()
  return CT.create({
    name: '测试券',
    type: 'discount',
    amount: 500,
    min_spend: 0,
    status: 'active',
    scope: { type: 'all' },
    ...overrides
  })
}

describe('Pricing.boundary', () => {
  it('PB-1 限定商品券：购物车无该商品时必须拒绝', async () => {
    const tpl = await makeCoupon({
      scope: { type: 'product', ids: [productA.id] },
      min_spend: 0,
      amount: 500
    })
    await expect(priceOrder({
      items: [{ product_id: productB.id, quantity: 1 }],
      userCouponId: null,
      userCoupon: { id: 1, template_id: tpl.id, status: 'unused', expire_at: null, template: tpl },
      paymentMethod: 'cod'
    })).rejects.toThrow(/不适用/)
  })

  it('PB-2 限定商品券：抵扣额只能落在适用商品上', async () => {
    const tpl = await makeCoupon({
      scope: { type: 'product', ids: [productA.id] },
      min_spend: 100,
      amount: 100
    })
    const res = await priceOrder({
      // A 商品 100（适用），B 商品 1000（不适用）
      items: [
        { product_id: productA.id, quantity: 1 },
        { product_id: productB.id, quantity: 1 }
      ],
      userCouponId: null,
      userCoupon: { id: 1, template_id: tpl.id, status: 'unused', expire_at: null, template: tpl },
      paymentMethod: 'cod'
    })
    const lineA = res.lines.find(l => l.product_id === productA.id)
    const lineB = res.lines.find(l => l.product_id === productB.id)
    // 抵扣全部落在 A 上，B 不受影响
    expect(lineA.discount_allocated).toBeGreaterThan(0)
    expect(lineB.discount_allocated).toBe(0)
    expect(res.applied_coupon.amount).toBe(100)
  })

  it('PB-3 限定商品券：抵扣额不超过适用商品满减后应付', async () => {
    const tpl = await makeCoupon({
      scope: { type: 'product', ids: [productA.id] },
      min_spend: 100,
      amount: 500   // 券额 500，但适用商品只有 100
    })
    const res = await priceOrder({
      items: [
        { product_id: productA.id, quantity: 1 },
        { product_id: productB.id, quantity: 1 }
      ],
      userCouponId: null,
      userCoupon: { id: 1, template_id: tpl.id, status: 'unused', expire_at: null, template: tpl },
      paymentMethod: 'cod'
    })
    // 只能抵到适用商品的 100，不能溢出到 B
    expect(res.applied_coupon.amount).toBe(100)
    expect(res.payable_thb).toBe(1000)
  })

  it('PB-4 券分摊后任何一行 discount_allocated 不得为负', async () => {
    const tpl = await makeCoupon({ min_spend: 1, amount: 0.02 })
    // 4 行 × 9.99：逐行向上取整会让总额多摊，尾差为负
    const { Product: P2 } = models()
    const cheap = await P2.create({
      name: '便宜', price: 9.99, stock: 100, category_id: cat.id, status: 'active'
    })
    const res = await priceOrder({
      items: Array.from({ length: 4 }, () => ({ product_id: cheap.id, quantity: 1 })),
      userCouponId: null,
      userCoupon: { id: 1, template_id: tpl.id, status: 'unused', expire_at: null, template: tpl },
      paymentMethod: 'cod'
    })
    for (const l of res.lines) {
      expect(l.discount_allocated).toBeGreaterThanOrEqual(0)
      expect(l.line_payable).toBeLessThanOrEqual(l.line_total)
    }
  })

  it('PB-5 单品直降价按整数分计算，不少 1 分', async () => {
    const { Product: P3 } = models()
    const p = await P3.create({
      name: '折扣品', price: 2052.15, stock: 100, category_id: cat.id, status: 'active', discount: 90
    })
    const res = await priceOrder({
      items: [{ product_id: p.id, quantity: 1 }],
      userCouponId: null,
      userCoupon: null,
      template: null,
      paymentMethod: 'cod'
    })
    // 2052.15 × 10% = 205.215 → 半进位为 205.22
    expect(res.lines[0].unit_price).toBe(205.22)
  })

  it('PB-6 订单金额超上限返回 400 业务错误而非 500', async () => {
    const { Product: P4 } = models()
    const huge = await P4.create({
      name: '天价商品', price: 99999999, stock: 10000, category_id: cat.id, status: 'active'
    })
    await expect(priceOrder({
      items: [{ product_id: huge.id, quantity: 5000 }],
      userCouponId: null,
      userCoupon: null,
      template: null,
      paymentMethod: 'cod'
    })).rejects.toThrow(/超出系统上限/)
  })


  it('PB-7 组合包展开行数量不套用单品 5000 上限', async () => {
    const { Bundle: BU, BundleItem: BI, Product: P5 } = models()
    // 组件配比 3：买 1667 个组合包 → 展开行数量 5001（超过单品 5000 上限）
    const comp = await P5.create({
      name: '组件', price: 10, stock: 100000, category_id: cat.id, status: 'active'
    })
    const bundle = await BU.create({
      name: '大组合包', price: 100, stock: 100000, status: 'active'
    })
    await BI.create({ bundle_id: bundle.id, product_id: comp.id, quantity: 3, sort_order: 1 })

    const res = await priceOrder({
      items: [{ bundle_id: bundle.id, quantity: 1667 }],
      paymentMethod: 'cod'
    })
    // 展开行数量 5001 合法，不应被单品上限误拒
    expect(res.lines.length).toBe(1)
    expect(res.lines[0].quantity).toBe(5001)
  })

  it('PB-8 金额守恒：items_total - discount_amount === payable_thb', async () => {
    const tpl = await makeCoupon({ min_spend: 100, amount: 50 })
    const res = await priceOrder({
      items: [
        { product_id: productA.id, quantity: 2 },
        { product_id: productB.id, quantity: 3 }
      ],
      userCouponId: null,
      userCoupon: { id: 1, template_id: tpl.id, status: 'unused', expire_at: null, template: tpl },
      paymentMethod: 'cod'
    })
    expect(res.payable_thb).toBeCloseTo(res.items_total - res.discount_amount, 2)
    const linesSum = res.lines.reduce((s, l) => s + l.line_payable, 0)
    expect(linesSum).toBeCloseTo(res.payable_thb, 2)
  })

  it('PB-9 券抵扣后 payable_thb 不得为负', async () => {
    const tpl = await makeCoupon({ min_spend: 1, amount: 999999 })
    const res = await priceOrder({
      items: [{ product_id: productA.id, quantity: 1 }],
      userCouponId: null,
      userCoupon: { id: 1, template_id: tpl.id, status: 'unused', expire_at: null, template: tpl },
      paymentMethod: 'cod'
    })
    expect(res.payable_thb).toBeGreaterThanOrEqual(0)
    expect(res.applied_coupon.amount).toBeLessThanOrEqual(res.items_total)
  })
})
