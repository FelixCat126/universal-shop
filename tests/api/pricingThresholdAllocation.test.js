/**
 * 满减（第 2 层）行分摊的尾差：不得出现负数行级金额
 *
 * 券层（第 3 层）早就有这层保护：
 *   if (adjusted < 0) adjusted = 0
 * 满减层**没有** —— 尾差为负时直接加到最大行上，可能把该行的
 * discount_allocated 压成负数（于是 line_payable > line_total，
 * 这一行反而比原价还贵），而且 Σ行分摊 > 优惠总额 → 订单总额与明细之和对不上。
 *
 * 触发条件不需要"奇怪配置"：只要行数多、优惠额小，逐行 round2 的向上取整
 * 累积起来就会超过优惠额本身（券层测试 PB-4 用的是同一组数字：
 * 4 行 × 9.99、优惠额 0.02）。
 *
 *   TA-1 满减分摊后任何一行 discount_allocated ≥ 0
 *   TA-2 满减分摊后任何一行 line_payable ≤ line_total
 *   TA-3 Σ行分摊 ≤ 优惠总额（不多摊）
 *   TA-4 正常场景下分摊总额 == 优惠总额（不多不少）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { priceOrder } from '@server/services/pricingEngine.js'
import { TestDatabase } from '../setup/test-database.js'

const models = () => TestDatabase.getSequelize().models

let cat
let cheap

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { ProductCategory, Product } = models()
  cat = await ProductCategory.create({ name: '满减测试分类' })
  cheap = await Product.create({
    name: '九块九', price: 9.99, stock: 100, category_id: cat.id, status: 'active'
  })
})

/** 建一个满减活动 */
async function makeThreshold (tiers, scope = { type: 'all', ids: [] }) {
  const { Promotion } = models()
  return Promotion.create({
    name: '测试满减',
    type: 'threshold',
    rules: { tiers },
    scope,
    priority: 0,
    status: 'active'
  })
}

describe('满减行分摊的尾差', () => {
  it('TA-1 满减分摊后任何一行 discount_allocated ≥ 0', async () => {
    // 与券层 PB-4 同一组数字：4 行 × 9.99、优惠额 0.02
    await makeThreshold([{ min: 1, off: 0.02 }])

    const res = await priceOrder({
      items: Array.from({ length: 4 }, () => ({ product_id: cheap.id, quantity: 1 })),
      paymentMethod: 'cod'
    })

    for (const l of res.lines) {
      expect(l.discount_allocated, `行分摊不能为负：${JSON.stringify(l)}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('TA-2 满减分摊后任何一行 line_payable ≤ line_total', async () => {
    await makeThreshold([{ min: 1, off: 0.02 }])

    const res = await priceOrder({
      items: Array.from({ length: 4 }, () => ({ product_id: cheap.id, quantity: 1 })),
      paymentMethod: 'cod'
    })

    for (const l of res.lines) {
      expect(l.line_payable, `行应付不能超过行小计：${JSON.stringify(l)}`).toBeLessThanOrEqual(l.line_total)
    }
  })

  it('TA-3 Σ行分摊 ≤ 优惠总额（不多摊）', async () => {
    await makeThreshold([{ min: 1, off: 0.02 }])

    const res = await priceOrder({
      items: Array.from({ length: 4 }, () => ({ product_id: cheap.id, quantity: 1 })),
      paymentMethod: 'cod'
    })

    const sum = res.lines.reduce((s, l) => s + Number(l.discount_allocated || 0), 0)
    expect(sum, `Σ行分摊 ${sum} 不该超过优惠总额 ${res.discount_amount}`).toBeLessThanOrEqual(
      Number(res.discount_amount) + 0.001
    )
  })

  it('TA-4 正常场景：分摊总额 == 优惠总额（该摊的都摊了）', async () => {
    await makeThreshold([{ min: 30, off: 10 }])

    const res = await priceOrder({
      items: Array.from({ length: 4 }, () => ({ product_id: cheap.id, quantity: 1 })),
      paymentMethod: 'cod'
    })

    const sum = res.lines.reduce((s, l) => s + Number(l.discount_allocated || 0), 0)
    expect(Number(res.discount_amount)).toBe(10)
    expect(sum).toBeCloseTo(10, 2)
  })
})
