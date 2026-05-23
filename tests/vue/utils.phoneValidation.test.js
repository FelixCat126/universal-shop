/**
 * VU-Phone — 手机号校验工具
 *   覆盖：
 *     PV-1 中国 11 位 1XX → valid
 *     PV-2 中国 10 位 → invalid（length）
 *     PV-3 泰国 9 位（首位 2-9） → valid
 *     PV-4 马来西亚 1XXX… → valid
 *     PV-5 不支持的国家区号 → invalid
 *     PV-6 空字符串 → invalid
 *     PV-7 中文 isSamePhone / formatPhoneDisplay
 */
import { describe, it, expect } from 'vitest'
import {
  validatePhone,
  formatPhoneDisplay,
  isSamePhone,
  getCountryInfo,
  getSupportedCountries,
  generatePhoneId
} from '@portal/utils/phoneValidation.js'

describe('VU.utils.phoneValidation', () => {
  it('PV-1 中国 11 位合法', () => {
    expect(validatePhone('13912345678', '+86').isValid).toBe(true)
  })
  it('PV-2 中国 10 位 → length 不对', () => {
    expect(validatePhone('1391234567', '+86').isValid).toBe(false)
  })
  it('PV-3 泰国 9 位', () => {
    expect(validatePhone('912345678', '+66').isValid).toBe(true)
    expect(validatePhone('012345678', '+66').isValid).toBe(false)
  })
  it('PV-4 马来西亚 11 位', () => {
    expect(validatePhone('11234567890', '+60').isValid).toBe(true)
  })
  it('PV-5 不支持的区号', () => {
    expect(validatePhone('12345', '+99').isValid).toBe(false)
  })
  it('PV-6 空串', () => {
    expect(validatePhone('', '+86').isValid).toBe(false)
    expect(validatePhone(null, '+86').isValid).toBe(false)
  })
  it('PV-7 工具函数', () => {
    expect(formatPhoneDisplay('13912345678', '+86')).toBe('+86 13912345678')
    expect(isSamePhone('a', '+86', 'a', '+86')).toBe(true)
    expect(isSamePhone('a', '+86', 'a', '+66')).toBe(false)
    expect(getCountryInfo('+86').phoneLength).toBe(11)
    expect(getCountryInfo('+99')).toBeNull()
    expect(getSupportedCountries().length).toBe(3)
    expect(generatePhoneId('123', '+86')).toBe('+86:123')
  })
})
