/**
 * useAutoRefresh 测试
 *
 * 自动刷新最容易出的问题是"**该停的时候没停**"——
 * 离开页面还在刷（白耗服务器）、页面看不见还在刷（白耗流量）。
 *
 *   AR-1 定时器按间隔触发刷新
 *   AR-2 组件卸载 → 定时器清掉（不再刷新）
 *   AR-3 页面不可见（document.hidden）→ 不刷新
 *   AR-4 调用方的额外条件（如弹窗打开）→ 不刷新
 *   AR-5 刷新抛错 → 定时器不停（下一轮还会试）
 *   AR-6 start 可重复调用，不会叠加多个定时器
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useAutoRefresh } from '@/admin/composables/useAutoRefresh.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 挂一个用 useAutoRefresh 的组件 */
function mountWith (fn, options = {}) {
  let api
  const Comp = defineComponent({
    setup () {
      api = useAutoRefresh(fn, options)
      return () => h('div')
    }
  })
  const wrapper = mount(Comp)
  return { wrapper, api }
}

describe('useAutoRefresh', () => {
  it('AR-1 定时器按间隔触发刷新', async () => {
    const fn = vi.fn()
    mountWith(fn, { intervalMs: 1000 })
    await nextTick()

    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('AR-2 组件卸载 → 定时器清掉', async () => {
    const fn = vi.fn()
    const { wrapper } = mountWith(fn, { intervalMs: 1000 })
    await nextTick()

    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    vi.advanceTimersByTime(5000)
    expect(fn, '卸载后不应再刷新').toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount(), '卸载后不应残留定时器').toBe(0)
  })

  it('AR-3 页面不可见（document.hidden）→ 不刷新', async () => {
    const fn = vi.fn()
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    try {
      mountWith(fn, { intervalMs: 1000 })
      await nextTick()
      vi.advanceTimersByTime(3000)
      expect(fn, '页面不可见时不应刷新').not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(Document.prototype, 'hidden', original)
      delete document.hidden
    }
  })

  it('AR-4 调用方的额外条件 → 不刷新', async () => {
    const fn = vi.fn()
    let busy = true
    mountWith(fn, { intervalMs: 1000, shouldRefresh: () => !busy })
    await nextTick()

    vi.advanceTimersByTime(2000)
    expect(fn, '条件不满足时不应刷新').not.toHaveBeenCalled()

    busy = false
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('AR-5 刷新抛错 → 定时器不停', async () => {
    const fn = vi.fn(() => { throw new Error('boom') })
    mountWith(fn, { intervalMs: 1000 })
    await nextTick()

    expect(() => vi.advanceTimersByTime(3000)).not.toThrow()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('AR-6 start 可重复调用，不会叠加多个定时器', async () => {
    const fn = vi.fn()
    const { api } = mountWith(fn, { intervalMs: 1000 })
    await nextTick()

    api.start()
    api.start()
    expect(vi.getTimerCount(), '应只有一个定时器').toBe(1)

    vi.advanceTimersByTime(1000)
    expect(fn, '重复 start 后一轮只刷一次').toHaveBeenCalledTimes(1)
  })
})
