/**
 * VU-FX — 多币种展示工具
 *   覆盖：
 *     FX-1 symbolForCurrencyCode 全枚举
 *     FX-2 convertedAmountLines 多行排序与跳过 0 比例
 *     FX-3 convertThbToCurrency THB / 外币 / 缺汇率
 *     FX-4 formatConvertedMoney 缺/0 汇率回退到 THB（避免 ¥0.00 误导）
 *     FX-5 PORTAL_CURRENCIES 至少 4 种 + FX_DISPLAY_ORDER 三种
 */
import { describe, it, expect } from 'vitest'
import {
  symbolForCurrencyCode,
  convertedAmountLines,
  convertThbToCurrency,
  formatConvertedMoney,
  PORTAL_CURRENCIES,
  FX_DISPLAY_ORDER
} from '@/utils/exchangeRatesDisplay.js'

describe('VU.utils.exchangeRatesDisplay', () => {
  it('FX-1 symbol 全枚举', () => {
    expect(symbolForCurrencyCode('THB')).toBe('฿')
    expect(symbolForCurrencyCode('USD')).toBe('$')
    expect(symbolForCurrencyCode('CNY')).toBe('¥')
    expect(symbolForCurrencyCode('MYR')).toBe('RM')
    expect(symbolForCurrencyCode('XXX')).toBe('')
  })

  it('FX-2 convertedAmountLines 跳过 0 / 缺失 / 非法比例', () => {
    const lines = convertedAmountLines(100, { USD: '0.03', CNY: '0', MYR: '0.13' })
    expect(lines.length).toBe(2)
    expect(lines[0]).toEqual({ key: 'USD', symbol: '$', amount: '3.00' })
    expect(lines[1]).toEqual({ key: 'MYR', symbol: 'RM', amount: '13.00' })

    expect(convertedAmountLines(100, null)).toEqual([])
    expect(convertedAmountLines(100, undefined)).toEqual([])
    expect(convertedAmountLines(100, {})).toEqual([])
  })

  it('FX-3 convertThbToCurrency', () => {
    expect(convertThbToCurrency(100, 'THB', {})).toBe(100)
    expect(convertThbToCurrency(100, 'USD', { USD: '0.03' })).toBe(3)
    expect(convertThbToCurrency(100, 'CNY', { CNY: '0' })).toBe(0)
    expect(convertThbToCurrency(100, 'CNY', null)).toBe(0)
  })

  it('FX-4 formatConvertedMoney 缺汇率回退 THB', () => {
    expect(formatConvertedMoney(100, 'THB', {})).toBe('฿100.00')
    expect(formatConvertedMoney(100, 'CNY', { CNY: '0.20' })).toBe('¥20.00')
    expect(formatConvertedMoney(100, 'CNY', { CNY: '0' })).toBe('฿100.00')
    expect(formatConvertedMoney(0, 'CNY', { CNY: '0' })).toBe('¥0.00')
  })

  it('FX-5 常量配置', () => {
    expect(PORTAL_CURRENCIES.length).toBeGreaterThanOrEqual(4)
    expect(FX_DISPLAY_ORDER.map((x) => x.key)).toEqual(['USD', 'CNY', 'MYR'])
  })

  it('FX-6 convertedAmountLines 按 FX_DISPLAY_ORDER 排序', () => {
    const lines = convertedAmountLines(100, { USD: '0.03', CNY: '0.20', MYR: '0.13' })
    expect(lines.map((x) => x.key)).toEqual(['USD', 'CNY', 'MYR'])
  })

  it('FX-7 convertThbToCurrency 边界（字符串 / NaN / 负数）', () => {
    expect(convertThbToCurrency('100', 'USD', { USD: '0.03' })).toBe(3)
    expect(convertThbToCurrency('abc', 'USD', { USD: '0.03' })).toBe(0)
    expect(convertThbToCurrency(100, 'USD', { USD: '-0.01' })).toBe(0)
    expect(convertThbToCurrency(100, 'USD', { USD: 'abc' })).toBe(0)
  })

  it('FX-8 formatConvertedMoney THB 直接显示', () => {
    expect(formatConvertedMoney(99.99, 'THB', {})).toBe('฿99.99')
    expect(formatConvertedMoney(0, 'THB', {})).toBe('฿0.00')
  })

  it('FX-9 formatConvertedMoney 汇率为 0 回退 THB', () => {
    expect(formatConvertedMoney(100, 'USD', { USD: '0' })).toBe('฿100.00')
    expect(formatConvertedMoney(100, 'USD', {})).toBe('฿100.00')
    expect(formatConvertedMoney(100, 'USD', null)).toBe('฿100.00')
  })

  it('FX-10 formatConvertedMoney 非法 currencyCode 兜底', () => {
    // 修复后：未知币种 code 时回退 THB（带 ฿ 前缀）
    expect(formatConvertedMoney(100, 'XXX', { XXX: '0.5' })).toBe('฿100.00')
  })

  it('FX-11 formatConvertedMoney 大数', () => {
    expect(formatConvertedMoney(1234567.89, 'USD', { USD: '0.03' })).toBe('$37037.04')
  })
})
