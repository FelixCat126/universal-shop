/**
 * VC-useToast — Toast 通知
 *
 * 覆盖：
 *   T-1 success/error/warning/info 入列
 *   T-2 showToast 返回自增 id
 *   T-3 duration=0 不自动隐藏
 *   T-4 duration>0 自动 hideToast（3000ms）
 *   T-5 hideToast 移除元素
 *   T-6 clearToasts 一次性清空
 *   T-7 visible=false 触发 300ms 延迟移除
 *   T-8 多个 toast 并存
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { useToast } = await import('@portal/composables/useToast.js')

beforeEach(() => {
  vi.useFakeTimers()
  // 清空 toasts 数组
  const { clearToasts } = useToast()
  clearToasts()
  vi.advanceTimersByTime(500)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VC.composables.useToast', () => {
  it('T-1 success/error/warning/info 入列', () => {
    const t = useToast()
    t.success('ok')
    t.error('err')
    t.warning('warn')
    t.info('info')
    expect(t.toasts.value.length).toBe(4)
    expect(t.toasts.value[0].type).toBe('success')
    expect(t.toasts.value[1].type).toBe('error')
    expect(t.toasts.value[2].type).toBe('warning')
    expect(t.toasts.value[3].type).toBe('info')
  })

  it('T-2 showToast 返回自增 id', () => {
    const t = useToast()
    const id1 = t.showToast('a')
    const id2 = t.showToast('b')
    expect(id2).toBe(id1 + 1)
  })

  it('T-3 duration=0 不自动隐藏', () => {
    const t = useToast()
    t.showToast('stay', 'info', 0)
    vi.advanceTimersByTime(10000)
    expect(t.toasts.value.length).toBe(1)
    expect(t.toasts.value[0].visible).toBe(true)
  })

  it('T-4 duration>0 自动 hideToast', () => {
    const t = useToast()
    t.showToast('temp', 'info', 3000)
    vi.advanceTimersByTime(3100)
    // hideToast 触发 visible=false，再 300ms 后移除
    vi.advanceTimersByTime(500)
    expect(t.toasts.value.length).toBe(0)
  })

  it('T-5 hideToast 移除元素', () => {
    const t = useToast()
    const id = t.showToast('x', 'info', 0)
    t.hideToast(id)
    vi.advanceTimersByTime(500)
    expect(t.toasts.value.length).toBe(0)
  })

  it('T-6 clearToasts 一次性清空', () => {
    const t = useToast()
    t.showToast('a', 'info', 0)
    t.showToast('b', 'info', 0)
    t.showToast('c', 'info', 0)
    t.clearToasts()
    vi.advanceTimersByTime(500)
    expect(t.toasts.value.length).toBe(0)
  })

  it('T-7 visible=false 触发 300ms 延迟移除', () => {
    const t = useToast()
    t.showToast('x', 'info', 0)
    const id = t.toasts.value[0].id
    t.hideToast(id)
    // 300ms 后从数组移除
    expect(t.toasts.value[0]?.visible).toBe(false)
    vi.advanceTimersByTime(500)
    expect(t.toasts.value.length).toBe(0)
  })

  it('T-8 多个 toast 并存', () => {
    const t = useToast()
    t.success('1')
    t.success('2')
    t.success('3')
    expect(t.toasts.value.length).toBe(3)
    expect(t.toasts.value.map((x) => x.message)).toEqual(['1', '2', '3'])
  })
})
