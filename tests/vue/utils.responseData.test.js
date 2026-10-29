/**
 * 响应列表解析契约（8 用例）
 *
 * 后端不同接口的列表形态不统一（数组 / { list } / { items } / { rows } ...），
 * 前端若一律用 Array.isArray(res.data.data) 判断，遇到包装对象恒为 false，
 * 列表静默变空 —— 不报错，但功能整体不可用。
 *
 * 真实踩过：抵扣券 available/mine 后端返回 data:{ list }，
 * 前端当数组用 → 领券中心与结算页选券全哑火（券功能完全不可达）。
 */
import { describe, it, expect } from 'vitest'
import { extractList, extractListFromResponse } from '@portal/utils/responseData.js'

describe('ResponseData.extractList', () => {
  it('RD-1 直接数组', () => {
    expect(extractList([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('RD-2 { list: [...] }（抵扣券契约）', () => {
    expect(extractList({ list: [{ id: 1 }] })).toEqual([{ id: 1 }])
  })

  it('RD-3 { items: [...] }', () => {
    expect(extractList({ items: ['a'] })).toEqual(['a'])
  })

  it('RD-4 { rows: [...] }', () => {
    expect(extractList({ rows: ['b'] })).toEqual(['b'])
  })

  it('RD-5 null / undefined / 非对象 → 空数组', () => {
    expect(extractList(null)).toEqual([])
    expect(extractList(undefined)).toEqual([])
    expect(extractList('not a list')).toEqual([])
    expect(extractList(42)).toEqual([])
    expect(extractList({})).toEqual([])
  })

  it('RD-6 包装对象里的 list 非数组时回退空数组', () => {
    expect(extractList({ list: 'oops' })).toEqual([])
    expect(extractList({ list: null })).toEqual([])
  })

  it('RD-7 extractListFromResponse：success=false 时返回空数组', () => {
    expect(extractListFromResponse({ data: { success: false, data: { list: [1] } } })).toEqual([])
    expect(extractListFromResponse({ data: { success: false, message: 'x' } })).toEqual([])
  })

  it('RD-8 extractListFromResponse：success=true 时按形态解析', () => {
    expect(extractListFromResponse({ data: { success: true, data: { list: [7] } } })).toEqual([7])
    expect(extractListFromResponse({ data: { success: true, data: [8] } })).toEqual([8])
    expect(extractListFromResponse(null)).toEqual([])
  })
})
