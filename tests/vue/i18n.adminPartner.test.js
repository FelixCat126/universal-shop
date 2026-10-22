/**
 * Admin / Partner 三语言 key 对齐 + Portal 法务 key（5 用例）
 */
import { describe, it, expect } from 'vitest'

function flattenKeys (obj, prefix = '') {
  const out = []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenKeys(v, path))
    else out.push(path)
  }
  return out
}

describe('I18n.adminPartner', () => {
  it('Admin 三语言 key 完全对齐', async () => {
    const zh = (await import('@admin/i18n/zh-CN.js')).default
    const en = (await import('@admin/i18n/en-US.js')).default
    const th = (await import('@admin/i18n/th-TH.js')).default
    const zk = flattenKeys(zh), ek = flattenKeys(en), tk = flattenKeys(th)
    expect(zk.sort()).toEqual(ek.sort())
    expect(ek.sort()).toEqual(tk.sort())
  })

  it('Partner 三语言 key 完全对齐', async () => {
    const zh = (await import('@partner/i18n/zh-CN.js')).default
    const en = (await import('@partner/i18n/en-US.js')).default
    const th = (await import('@partner/i18n/th-TH.js')).default
    const zk = flattenKeys(zh), ek = flattenKeys(en), tk = flattenKeys(th)
    expect(zk.sort()).toEqual(ek.sort())
    expect(ek.sort()).toEqual(tk.sort())
  })

  it('Portal 隐私政策与用户协议三语言 key 存在', async () => {
    const locales = [
      (await import('@portal/i18n/zh-CN.js')).default,
      (await import('@portal/i18n/en-US.js')).default,
      (await import('@portal/i18n/th-TH.js')).default
    ]
    for (const data of locales) {
      expect(data.legal.termsTitle).toBeTruthy()
      expect(data.legal.termsBody).toBeTruthy()
      expect(data.legal.privacyTitle).toBeTruthy()
      expect(data.legal.privacyBody).toBeTruthy()
      expect(data.legal.termsLink).toBeTruthy()
      expect(data.legal.privacyLink).toBeTruthy()
    }
  })

  it('Portal 法务页面路由已注册', async () => {
    const router = (await import('@portal/router/index.js')).default
    const names = router.getRoutes().map((r) => r.name)
    expect(names).toContain('Privacy')
    expect(names).toContain('Terms')
  })

  it('减少动画 composable 可被导入', async () => {
    const { useReducedMotion } = await import('@portal/composables/useReducedMotion.js')
    expect(typeof useReducedMotion).toBe('function')
  })
})
