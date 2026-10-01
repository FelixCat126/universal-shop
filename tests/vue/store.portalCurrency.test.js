/**
 * VS-PortalCurrency — 币种 Pinia Store
 *
 * 覆盖：
 *   PC-1 默认 selectedCode='THB'
 *   PC-2 loadRates 成功 → rates 更新
 *   PC-3 loadRates 失败 → loaded=true 兜底
 *   PC-4 applyDefaultForLocale('zh-CN') → CNY
 *   PC-5 applyDefaultForLocale('en-US') → USD
 *   PC-6 applyDefaultForLocale('th-TH') → THB
 *   PC-7 setCurrency('xxx') 非法值忽略
 *   PC-8 initFromStorage 有缓存 → 用缓存
 *   PC-9 initFromStorage 无缓存 → 走 locale 默认
 *   PC-10 formatThb 带当前币种
 *   PC-11 convertThbNumber 数学正确
 *   PC-12 labelFor 返回对应 label
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { usePortalCurrencyStore } = await import('@portal/stores/portalCurrency.js')
const { resetPublicConfigCache } = await import('@/utils/publicConfig.js')

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.unstubAllGlobals()
  // loadRates 走 publicConfig 模块级缓存，用例间需重置避免串数据
  resetPublicConfigCache()
})

describe('VS.store.portalCurrency', () => {
  it('PC-1 默认 selectedCode=THB', () => {
    const c = usePortalCurrencyStore()
    expect(c.selectedCode).toBe('THB')
  })

  it('PC-2 loadRates 成功 → rates 更新', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { exchange_rates: { USD: '0.03', CNY: '0.20', MYR: '0.13' } } })
    }))
    const c = usePortalCurrencyStore()
    await c.loadRates()
    expect(c.rates.USD).toBe('0.03')
    expect(c.rates.CNY).toBe('0.20')
    expect(c.loaded).toBe(true)
  })

  it('PC-3 loadRates 失败 → loaded=true 兜底', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const c = usePortalCurrencyStore()
    await c.loadRates()
    expect(c.loaded).toBe(true)
  })

  it('PC-4 applyDefaultForLocale(zh-CN) → CNY', () => {
    const c = usePortalCurrencyStore()
    c.applyDefaultForLocale('zh-CN')
    expect(c.selectedCode).toBe('CNY')
  })

  it('PC-5 applyDefaultForLocale(en-US) → USD', () => {
    const c = usePortalCurrencyStore()
    c.applyDefaultForLocale('en-US')
    expect(c.selectedCode).toBe('USD')
  })

  it('PC-6 applyDefaultForLocale(th-TH) → THB', () => {
    const c = usePortalCurrencyStore()
    c.applyDefaultForLocale('th-TH')
    expect(c.selectedCode).toBe('THB')
  })

  it('PC-7 setCurrency(xxx) 非法值忽略', () => {
    const c = usePortalCurrencyStore()
    c.setCurrency('xxx')
    expect(c.selectedCode).toBe('THB') // 不变
  })

  it('PC-8 initFromStorage 有缓存 → 用缓存', () => {
    localStorage.setItem('portal_currency', 'MYR')
    const c = usePortalCurrencyStore()
    c.initFromStorage('zh-CN')
    expect(c.selectedCode).toBe('MYR')
  })

  it('PC-9 initFromStorage 无缓存 → 走 locale 默认', () => {
    const c = usePortalCurrencyStore()
    c.initFromStorage('zh-CN')
    expect(c.selectedCode).toBe('CNY')
  })

  it('PC-10 formatThb 带当前币种', async () => {
    const c = usePortalCurrencyStore()
    c.rates = { USD: '0.03', CNY: '0.20', MYR: '0.13' }
    c.setCurrency('USD')
    expect(c.formatThb(100)).toBe('$3.00')
  })

  it('PC-11 convertThbNumber 数学正确', async () => {
    const c = usePortalCurrencyStore()
    c.rates = { USD: '0.03', CNY: '0.20', MYR: '0.13' }
    c.setCurrency('CNY')
    expect(c.convertThbNumber(100)).toBe(20)
  })

  it('PC-12 labelFor 返回对应 label', () => {
    const c = usePortalCurrencyStore()
    expect(c.labelFor('USD')).toContain('USD')
    expect(c.labelFor('THB')).toContain('THB')
  })
})
