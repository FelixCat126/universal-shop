/**
 * VU-Password — 密码策略校验
 *   覆盖：
 *     PP-1 空 → null
 *     PP-2 < 8 → 'short'
 *     PP-3 缺数字 → 'digit'
 *     PP-4 缺字母 → 'letter'
 *     PP-5 合法 → null
 *     PP-6 边界 8 位刚好（含字母+数字）→ null
 */
import { describe, it, expect } from 'vitest'
import {
  PASSWORD_MIN_LEN,
  describePasswordPolicyFailure
} from '@portal/utils/passwordPolicy.js'

describe('VU.utils.passwordPolicy', () => {
  it('PP-0 常量', () => {
    expect(PASSWORD_MIN_LEN).toBe(8)
  })
  it('PP-1 空 → null', () => {
    expect(describePasswordPolicyFailure('')).toBeNull()
    expect(describePasswordPolicyFailure(null)).toBeNull()
  })
  it('PP-2 短 → short', () => {
    expect(describePasswordPolicyFailure('Ab12')).toBe('short')
  })
  it('PP-3 缺数字 → digit', () => {
    expect(describePasswordPolicyFailure('AbcdEFgh')).toBe('digit')
  })
  it('PP-4 缺字母 → letter', () => {
    expect(describePasswordPolicyFailure('12345678')).toBe('letter')
  })
  it('PP-5 合法 → null', () => {
    expect(describePasswordPolicyFailure('Aa123456')).toBeNull()
    expect(describePasswordPolicyFailure('Strong#1234')).toBeNull()
  })
  it('PP-6 8 位边界 字母+数字 → null', () => {
    expect(describePasswordPolicyFailure('Ab123456')).toBeNull()
  })
})
