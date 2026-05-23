/**
 * VU-Billing — 订单展示工具
 *   覆盖：
 *     OB-1 formatRecordedOrderAmount 标准 THB 单
 *     OB-2 formatRecordedOrderAmount 多币种回写
 *     OB-3 formatRecordedOrderAmount 缺 total_amount_thb → amountThb=null
 *     OB-4 formatLineRecordedFromThb 等比例分摊
 *     OB-5 formatLineRecordedFromThb 异常值兜底（非数）
 */
import { describe, it, expect } from 'vitest'
import {
  formatRecordedOrderAmount,
  formatLineRecordedFromThb
} from '@portal/utils/orderBillingDisplay.js'

describe('VU.utils.orderBillingDisplay', () => {
  it('OB-1 标准 THB 单', () => {
    const out = formatRecordedOrderAmount({
      currency_code: 'THB', total_amount: '120.00', total_amount_thb: '120.00'
    })
    expect(out.currencyCode).toBe('THB')
    expect(out.mainLabel).toBe('THB ฿120.00')
    expect(out.amountThb).toBe(120)
  })

  it('OB-2 CNY 记账单', () => {
    const out = formatRecordedOrderAmount({
      currency_code: 'CNY', total_amount: '24.00', total_amount_thb: '120.00'
    })
    expect(out.currencyCode).toBe('CNY')
    expect(out.mainLabel).toBe('CNY ¥24.00')
    expect(out.amountThb).toBe(120)
  })

  it('OB-3 缺 amountThb', () => {
    const out = formatRecordedOrderAmount({
      currency_code: 'USD', total_amount: '5.00'
    })
    expect(out.amountThb).toBeNull()
  })

  it('OB-4 line 按 thb 分摊到记账币种', () => {
    const order = {
      currency_code: 'CNY', total_amount: '24.00', total_amount_thb: '120.00'
    }
    expect(formatLineRecordedFromThb(order, 60)).toBe('CNY ¥12.00')
    expect(formatLineRecordedFromThb(order, 120)).toBe('CNY ¥24.00')
  })

  it('OB-5 异常值兜底', () => {
    const order = { currency_code: 'CNY', total_amount: '0', total_amount_thb: '0' }
    expect(formatLineRecordedFromThb(order, 'abc')).toMatch(/CNY ¥0\.00/)
  })
})
