/**
 * 致命错误兜底测试（utils/fatalError）
 *
 * 三端共用的错误收口：组件抛错时界面不要白屏，
 * 而是把错误收进来，由 App.vue 渲染一个可操作的兜底页。
 *
 *   FE-1 初始没有错误
 *   FE-2 上报后有错误（带消息与时间）
 *   FE-3 重复上报不覆盖首个错误（真正的首个错误最有用）
 *   FE-4 clearFatalError 清空
 *   FE-5 字符串错误也能上报
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  fatalError,
  reportFatalError,
  clearFatalError
} from '@/utils/fatalError.js'

beforeEach(() => {
  clearFatalError()
})

describe('致命错误兜底', () => {
  it('FE-1 初始没有错误', () => {
    expect(fatalError.value).toBeNull()
  })

  it('FE-2 上报后有错误（带消息与时间）', () => {
    reportFatalError(new Error('组件崩了'), 'info')
    expect(fatalError.value).not.toBeNull()
    expect(fatalError.value.message).toContain('组件崩了')
    expect(fatalError.value.at).toBeTruthy()
  })

  it('FE-3 重复上报不覆盖首个错误', () => {
    reportFatalError(new Error('第一个错误'))
    reportFatalError(new Error('第二个错误'))
    expect(fatalError.value.message).toContain('第一个错误')
  })

  it('FE-4 clearFatalError 清空', () => {
    reportFatalError(new Error('x'))
    clearFatalError()
    expect(fatalError.value).toBeNull()
  })

  it('FE-5 字符串错误也能上报', () => {
    reportFatalError('纯字符串错误')
    expect(fatalError.value.message).toContain('纯字符串错误')
  })
})
