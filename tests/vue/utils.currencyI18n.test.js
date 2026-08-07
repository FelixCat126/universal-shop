/**
 * VU-currencyI18n — 货币国际化
 *
 * 覆盖：
 *   CI-1 normalizeCurrencyCode 默认 THB
 *   CI-2 normalizeCurrencyCode '¥' / 'RMB' / '元' → CNY
 *   CI-3 normalizeCurrencyCode '$' / 'US$' → USD
 *   CI-4 normalizeCurrencyCode '฿' → THB
 *   CI-5 normalizeCurrencyCode 未知 → THB
 *   CI-6 applyCurrencyCodeToI18n 写入 3 个 locale
 *   CI-7 mergeCurrencyCodeIntoLocales 用 callback 写入
 *   CI-8 fetchAndApplyCurrencyUnit 200 时调 applyCurrencyCodeToI18n
 *   CI-9 fetchAndApplyCurrencyUnit 失败兜底 THB
 *   CI-10 fetchAndApplyCurrencyUnit 空 currency_code 用 currency_unit 兜底
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

const {
  normalizeCurrencyCode,
  applyCurrencyCodeToI18n,
  mergeCurrencyCodeIntoLocales,
  fetchAndApplyCurrencyUnit
} = await import('@/utils/currencyI18n.js')

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('VU.utils.currencyI18n', () => {
  it('CI-1 normalizeCurrencyCode 默认 THB', () => {
    expect(normalizeCurrencyCode(null)).toBe('THB')
    expect(normalizeCurrencyCode('')).toBe('THB')
    expect(normalizeCurrencyCode(undefined)).toBe('THB')
  })

  it('CI-2 normalizeCurrencyCode CNY 别名', () => {
    expect(normalizeCurrencyCode('¥')).toBe('CNY')
    expect(normalizeCurrencyCode('RMB')).toBe('CNY')
    expect(normalizeCurrencyCode('元')).toBe('CNY')
    expect(normalizeCurrencyCode('人民币')).toBe('CNY')
    expect(normalizeCurrencyCode('CNY')).toBe('CNY')
  })

  it('CI-3 normalizeCurrencyCode USD 别名', () => {
    expect(normalizeCurrencyCode('$')).toBe('USD')
    expect(normalizeCurrencyCode('＄')).toBe('USD')
    expect(normalizeCurrencyCode('US$')).toBe('USD')
    expect(normalizeCurrencyCode('DOLLAR')).toBe('USD')
    expect(normalizeCurrencyCode('USD')).toBe('USD')
  })

  it('CI-4 normalizeCurrencyCode THB 别名', () => {
    expect(normalizeCurrencyCode('฿')).toBe('THB')
    expect(normalizeCurrencyCode('BAHT')).toBe('THB')
    expect(normalizeCurrencyCode('THB')).toBe('THB')
  })

  it('CI-5 normalizeCurrencyCode 未知 → THB', () => {
    expect(normalizeCurrencyCode('JPY')).toBe('THB')
    expect(normalizeCurrencyCode('EUR')).toBe('THB')
    expect(normalizeCurrencyCode('xyz')).toBe('THB')
  })

  it('CI-6 applyCurrencyCodeToI18n 写入 3 个 locale', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      messages: {
        'zh-CN': { common: {} },
        'en-US': { common: {} },
        'th-TH': { common: {} }
      }
    })
    applyCurrencyCodeToI18n(i18n, 'CNY')
    expect(i18n.global.te('common.currency', 'zh-CN')).toBe(true)
    expect(i18n.global.te('common.currency', 'en-US')).toBe(true)
    expect(i18n.global.te('common.currency', 'th-TH')).toBe(true)
    expect(i18n.global.t('common.currency', 'zh-CN')).toBe('¥')
  })

  it('CI-7 mergeCurrencyCodeIntoLocales 用 callback 写入', () => {
    const collected = []
    const merge = (locale, msg) => collected.push({ locale, msg })
    mergeCurrencyCodeIntoLocales(merge, 'USD')
    expect(collected.length).toBe(3)
    expect(collected[0].msg.common.currency).toBe('$')
  })

  it('CI-8 fetchAndApplyCurrencyUnit 200 时调 apply', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      messages: { 'zh-CN': { common: {} }, 'en-US': { common: {} }, 'th-TH': { common: {} } }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { currency_code: 'USD' } })
    }))
    await fetchAndApplyCurrencyUnit(i18n, '')
    expect(i18n.global.t('common.currency', 'zh-CN')).toBe('$')
  })

  it('CI-9 fetchAndApplyCurrencyUnit 失败兜底 THB', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      messages: { 'zh-CN': { common: {} }, 'en-US': { common: {} }, 'th-TH': { common: {} } }
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await fetchAndApplyCurrencyUnit(i18n, '')
    expect(i18n.global.t('common.currency', 'zh-CN')).toBe('฿')
  })

  it('CI-10 fetchAndApplyCurrencyUnit 空 currency_code 用 currency_unit 兜底', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      messages: { 'zh-CN': { common: {} }, 'en-US': { common: {} }, 'th-TH': { common: {} } }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { currency_code: '', currency_unit: 'CNY' } })
    }))
    await fetchAndApplyCurrencyUnit(i18n, '')
    expect(i18n.global.t('common.currency', 'zh-CN')).toBe('¥')
  })
})
