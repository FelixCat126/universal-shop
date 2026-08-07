/**
 * VI-I18n — 三语言 key 对齐（单向：zh-CN 必须有 en-US / th-TH 翻译）
 *
 * 验证规则：zh-CN 是主语言，业务在 zh-CN 有的 key 必须在 en-US / th-TH 有对应翻译；
 * 但 en-US / th-TH 多出的"潜在未来用 key"不要求 zh-CN 必须有（避免噪音）。
 *
 * 覆盖：
 *   I-1 三种语言顶层 key 大致一致（en 可以多）
 *   I-2 zh-CN 的 key 都在 en-US / th-TH 中存在
 *   I-3 关键 key 存在（common.currency / nav.home / nav.profile 等）
 *   I-4 zh-CN / en-US / th-TH 都无空字符串翻译
 */
import { describe, it, expect } from 'vitest'

import zhCN from '@portal/i18n/zh-CN.js'
import enUS from '@portal/i18n/en-US.js'
import thTH from '@portal/i18n/th-TH.js'

function flattenKeys (obj, prefix = '') {
  const out = []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v, path))
    } else {
      out.push(path)
    }
  }
  return out
}

describe('VI.portal.i18n', () => {
  const zhKeys = flattenKeys(zhCN)
  const enKeys = flattenKeys(enUS)
  const thKeys = flattenKeys(thTH)

  it('I-1 三种语言顶层 key 集合：zh ⊆ en，zh ⊆ th', () => {
    const zhTop = new Set(Object.keys(zhCN))
    const enTop = new Set(Object.keys(enUS))
    const thTop = new Set(Object.keys(thTH))
    for (const k of zhTop) {
      expect(enTop.has(k)).toBe(true)
      expect(thTop.has(k)).toBe(true)
    }
  })

  it('I-2 zh-CN 的所有 key 都在 en-US / th-TH 中存在', () => {
    const enSet = new Set(enKeys)
    const thSet = new Set(thKeys)
    const missingEn = zhKeys.filter((k) => !enSet.has(k))
    const missingTh = zhKeys.filter((k) => !thSet.has(k))
    expect(missingEn).toEqual([])
    expect(missingTh).toEqual([])
  })

  it('I-3 关键 key 存在', () => {
    expect(zhCN.common?.currency).toBeDefined()
    expect(zhCN.common?.currencyName).toBeDefined()
    expect(zhCN.nav?.home).toBeDefined()
    expect(zhCN.nav?.profile).toBeDefined()
    expect(enUS.common?.currency).toBeDefined()
    expect(thTH.common?.currency).toBeDefined()
  })

  it('I-4 三种语言都没有空字符串翻译', () => {
    function findEmpty (obj, path = '') {
      const out = []
      for (const k of Object.keys(obj)) {
        const v = obj[k]
        const p = path ? `${path}.${k}` : k
        if (v && typeof v === 'object') {
          out.push(...findEmpty(v, p))
        } else if (v === '' || v == null) {
          out.push(p)
        }
      }
      return out
    }
    expect(findEmpty(zhCN)).toEqual([])
    expect(findEmpty(enUS)).toEqual([])
    expect(findEmpty(thTH)).toEqual([])
  })

  it('I-5 用户高频使用的 key 必须在 en-US / th-TH 中存在', () => {
    // 抽样高频 key
    const critical = [
      'nav.home',
      'nav.profile',
      'nav.login',
      'nav.register',
      'nav.logout',
      'common.loading',
      'common.submit',
      'common.back',
      'product.addToCart',
      'product.buyNow',
      'cart.title',
      'cart.checkout',
      'order.title',
      'user.login',
      'user.register',
      'error.notFound'
    ]
    for (const k of critical) {
      const parts = k.split('.')
      let zhV = zhCN
      for (const p of parts) zhV = zhV?.[p]
      // zh-CN 必须有
      if (zhV === undefined) continue // 不在 zh-CN 就跳过（可能业务已下线）
      // 在 zh-CN 存在则 en/th 必须有
      let enV = enUS
      for (const p of parts) enV = enV?.[p]
      let thV = thTH
      for (const p of parts) thV = thV?.[p]
      expect(enV, `${k} 缺失 en-US 翻译`).toBeDefined()
      expect(thV, `${k} 缺失 th-TH 翻译`).toBeDefined()
    }
  })
})

