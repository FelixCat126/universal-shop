/**
 * 按权重分摊金额的**性质测试**
 *
 * ## 为什么用性质测试而不是几个例子
 *
 * 这个函数把一笔优惠额按各行金额占比分摊到行上，**每一分都必须落到某一行**：
 * 多落一分 = 少收客户一分钱；少落一分 = 多收。
 *
 * 举例测不出问题（几个例子恰好整除），必须断言**不变量**：
 *   - 分摊结果之和 === 原金额（精确到分）
 *   - 每一份都 >= 0（不能出现负分摊 → 该行比原价还贵）
 *   - 每一份 <= 原金额
 *   - 同样输入 → 同样输出（确定，便于对账）
 *   - 权重大的行分摊不小于权重小的行（单调）
 *
 * 历史背景：这里以前是"逐行 round2 + 尾差补给最大行"，**没有下界保护** ——
 * 逐行取整误差累积起来会超过优惠额本身，把最大行压成负数，
 * 导致「订单总额与明细之和对不上」（少收钱）。
 *
 *   AL-1 分摊之和恒等于原金额（精确到分）
 *   AL-2 每一份都非负、且不超过原金额
 *   AL-3 同样输入 → 同样输出（确定）
 *   AL-4 权重大的行分摊不小于权重小的行
 *   AL-5 退化输入（金额<=0 / 权重全 0 / 空数组）→ 全 0，不抛错
 */
import { describe, it, expect } from 'vitest'
import { allocateAmountByWeights } from '@server/services/pricingEngine.js'

/** 确定性伪随机（不引第三方依赖，也不让用例飘） */
function makeRng (seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const round2 = (n) => Math.round(n * 100) / 100

describe('按权重分摊金额', () => {
  it('AL-1 分摊之和恒等于原金额（精确到分）', () => {
    const rng = makeRng(20261114)
    for (let i = 0; i < 2000; i++) {
      const amount = Math.round(rng() * 500000) / 100        // 0 ~ 5000
      const n = 1 + Math.floor(rng() * 8)                   // 1 ~ 8 行
      const weights = Array.from({ length: n }, () => Math.round(rng() * 100000) / 100)
      const shares = allocateAmountByWeights(amount, weights)
      const sum = round2(shares.reduce((a, b) => a + b, 0))
      expect(sum, `amount=${amount} weights=${JSON.stringify(weights)} 分摊和=${sum}`).toBe(round2(amount))
    }
  })

  it('AL-2 每一份都非负、且不超过原金额', () => {
    const rng = makeRng(777)
    for (let i = 0; i < 2000; i++) {
      const amount = Math.round(rng() * 100000) / 100
      const weights = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => Math.round(rng() * 50000) / 100)
      const shares = allocateAmountByWeights(amount, weights)
      for (const [k, v] of shares.entries()) {
        expect(v, `第 ${k} 份为负（weights=${JSON.stringify(weights)}）`).toBeGreaterThanOrEqual(0)
        expect(v, `第 ${k} 份超过原金额`).toBeLessThanOrEqual(round2(amount) + 0.001)
      }
    }
  })

  it('AL-3 同样输入 → 同样输出（确定，便于对账）', () => {
    const rng = makeRng(31337)
    for (let i = 0; i < 500; i++) {
      const amount = Math.round(rng() * 100000) / 100
      const weights = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => Math.round(rng() * 20000) / 100)
      const a = allocateAmountByWeights(amount, weights)
      const b = allocateAmountByWeights(amount, weights)
      expect(b, '同样的输入得到了不同的分摊 → 对账无法复现').toEqual(a)
    }
  })

  it('AL-4 权重大的行分摊不小于权重小的行', () => {
    const rng = makeRng(4242)
    for (let i = 0; i < 1000; i++) {
      const amount = Math.round(rng() * 100000) / 100
      const weights = Array.from({ length: 2 + Math.floor(rng() * 5) }, () => Math.round(rng() * 30000) / 100)
      const shares = allocateAmountByWeights(amount, weights)
      for (let x = 0; x < weights.length; x++) {
        for (let y = 0; y < weights.length; y++) {
          if (weights[x] > weights[y]) {
            expect(shares[x], `权重 ${weights[x]} > ${weights[y]}，分摊却更少`).toBeGreaterThanOrEqual(shares[y])
          }
        }
      }
    }
  })

  it('AL-5 退化输入 → 全 0，不抛错', () => {
    expect(allocateAmountByWeights(0, [1, 2])).toEqual([0, 0])
    expect(allocateAmountByWeights(-5, [1, 2])).toEqual([0, 0])
    expect(allocateAmountByWeights(100, [0, 0])).toEqual([0, 0])
    expect(allocateAmountByWeights(100, [])).toEqual([])
    // 负权重按 0 处理（不产生负分摊）
    expect(allocateAmountByWeights(100, [-5, 10])).toEqual([0, 100])
  })
})
