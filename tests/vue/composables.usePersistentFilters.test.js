/**
 * 管理端筛选条件持久化测试（composables/usePersistentFilters）
 *
 * 运营每天重复几十次的摩擦：筛出一批 → 导出/核对 → 刷新或切页回来 → 筛选没了。
 * 而且很容易点错（忘了哪个筛选没勾上，导出的数据就不对）。
 *
 *   PF-1 首次使用：拿到初始值
 *   PF-2 有存储时：用存储里的值（只取声明过的字段）
 *   PF-3 存储里的未知字段被忽略（旧版本残留不混进来）
 *   PF-4 变更后写回存储
 *   PF-5 重置（改回空值）后存储也跟着变空
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  usePersistentFilters,
  clearPersistentFilters
} from '@/admin/composables/usePersistentFilters.js'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

describe('管理端筛选条件持久化', () => {
  it('PF-1 首次使用：拿到初始值', () => {
    const form = usePersistentFilters('t1', { name: '', status: '' })
    expect(form.name).toBe('')
    expect(form.status).toBe('')
  })

  it('PF-2 有存储时：用存储里的值', () => {
    localStorage.setItem('admin_filters_t2', JSON.stringify({ name: '奶茶', status: 'active' }))
    const form = usePersistentFilters('t2', { name: '', status: '' })
    expect(form.name).toBe('奶茶')
    expect(form.status).toBe('active')
  })

  it('PF-3 存储里的未知字段被忽略', () => {
    localStorage.setItem('admin_filters_t3', JSON.stringify({ name: 'x', legacyField: 'y' }))
    const form = usePersistentFilters('t3', { name: '', status: '' })
    expect(form.name).toBe('x')
    expect(form.legacyField).toBeUndefined()
  })

  it('PF-4 变更后写回存储', async () => {
    const form = usePersistentFilters('t4', { name: '' })
    form.name = '新的关键词'
    await nextTick()
    vi.advanceTimersByTime(400)
    const saved = JSON.parse(localStorage.getItem('admin_filters_t4'))
    expect(saved.name).toBe('新的关键词')
  })

  it('PF-5 重置后存储也跟着变空', async () => {
    const form = usePersistentFilters('t5', { name: '' })
    form.name = 'abc'
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(JSON.parse(localStorage.getItem('admin_filters_t5')).name).toBe('abc')

    form.name = '' // 重置
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(JSON.parse(localStorage.getItem('admin_filters_t5')).name).toBe('')
  })

  it('PF-6 clearPersistentFilters 清掉存储', () => {
    localStorage.setItem('admin_filters_t6', JSON.stringify({ name: 'x' }))
    clearPersistentFilters('t6')
    expect(localStorage.getItem('admin_filters_t6')).toBeNull()
  })
})
