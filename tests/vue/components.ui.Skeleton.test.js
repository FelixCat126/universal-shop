/**
 * VC-Skeleton — 骨架屏
 *
 * 覆盖：
 *   SK-1 SkeletonCard 结构（image + body + 3 lines）
 *   SK-2 SkeletonDetail 结构（image + body + 6 lines）
 *   SK-3 应用 shimmer 动画 class
 *   SK-4 多实例渲染
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkeletonCard from '@portal/components/ui/SkeletonCard.vue'
import SkeletonDetail from '@portal/components/ui/SkeletonDetail.vue'

describe('VC.components.ui.Skeleton', () => {
  it('SK-1 SkeletonCard 结构', () => {
    const wrapper = mount(SkeletonCard)
    expect(wrapper.find('.sk-card').exists()).toBe(true)
    expect(wrapper.find('.sk-image').exists()).toBe(true)
    expect(wrapper.find('.sk-body').exists()).toBe(true)
    // 3 行骨架线
    expect(wrapper.findAll('.sk-line').length).toBe(3)
  })

  it('SK-2 SkeletonDetail 结构', () => {
    const wrapper = mount(SkeletonDetail)
    expect(wrapper.find('.sk-detail').exists()).toBe(true)
    expect(wrapper.find('.sk-image').exists()).toBe(true)
    expect(wrapper.find('.sk-body').exists()).toBe(true)
    // 6 行骨架线
    expect(wrapper.findAll('.sk-line').length).toBe(6)
  })

  it('SK-3 应用 shimmer 动画 class（sk-card / sk-detail / sk-line）', () => {
    const card = mount(SkeletonCard)
    expect(card.find('.sk-card').exists()).toBe(true)
    const detail = mount(SkeletonDetail)
    expect(detail.find('.sk-detail').exists()).toBe(true)
  })

  it('SK-4 多实例渲染（列表用 8 张卡片）', () => {
    const items = Array.from({ length: 8 })
    const html = items.map(() => mount(SkeletonCard).html()).join('')
    expect(html.split('sk-card').length - 1).toBeGreaterThanOrEqual(8)
  })
})
