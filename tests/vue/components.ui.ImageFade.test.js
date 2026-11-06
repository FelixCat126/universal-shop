/**
 * VC-ImageFade — 图片 fade-in
 *
 * 覆盖：
 *   IF-1 初始 ui-img-fade，无 is-loaded
 *   IF-2 load 事件后 is-loaded class
 *   IF-3 error 事件：先退回主图重试（srcset 候选可能不存在）
 *   IF-3b 退回后仍失败 → is-loaded（兜底，不一直空白）
 *   IF-4 loading=lazy 默认
 *   IF-5 customClass 透传
 *   IF-6 alt / src 透传
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageFade from '@portal/components/ui/ImageFade.vue'

describe('VC.components.ui.ImageFade', () => {
  it('IF-1 初始 ui-img-fade，无 is-loaded', () => {
    const wrapper = mount(ImageFade, { props: { src: '/x.jpg' } })
    const img = wrapper.find('img')
    expect(img.classes()).toContain('ui-img-fade')
    expect(img.classes()).not.toContain('is-loaded')
  })

  it('IF-2 load 事件后 is-loaded', async () => {
    const wrapper = mount(ImageFade, { props: { src: '/x.jpg' } })
    await wrapper.find('img').trigger('load')
    expect(wrapper.find('img').classes()).toContain('is-loaded')
  })

  it('IF-3 第一次 error：先退回主图重试（srcset 候选可能不存在）', async () => {
    const wrapper = mount(ImageFade, {
      props: { src: '/uploads/products/p.jpg', srcset: '/uploads/products/p_thumb.webp 400w' }
    })
    await wrapper.find('img').trigger('error')
    const img = wrapper.find('img')
    // 退回主图：srcset 清空、src 指回主图
    expect(img.attributes('srcset')).toBe('') // 已清空
    expect(img.attributes('src')).toBe('/uploads/products/p.jpg')
    // 这时还没最终失败，先不标记 is-loaded（主图可能加载成功）
    expect(img.classes()).not.toContain('is-loaded')
  })

  it('IF-3b 退回主图后仍失败 → is-loaded（兜底，不一直空白）', async () => {
    const wrapper = mount(ImageFade, {
      props: { src: '/uploads/products/p.jpg', srcset: '/uploads/products/p_thumb.webp 400w' }
    })
    await wrapper.find('img').trigger('error')  // 第一次：退回主图
    await wrapper.find('img').trigger('error')  // 第二次：主图也不可用 → 兜底
    expect(wrapper.find('img').classes()).toContain('is-loaded')
  })

  it('IF-4 loading=lazy 默认', () => {
    const wrapper = mount(ImageFade, { props: { src: '/x.jpg' } })
    expect(wrapper.find('img').attributes('loading')).toBe('lazy')
  })

  it('IF-5 customClass 透传', () => {
    const wrapper = mount(ImageFade, {
      props: { src: '/x.jpg', customClass: 'rounded-lg shadow-md' }
    })
    const classes = wrapper.find('img').classes()
    expect(classes).toContain('rounded-lg')
    expect(classes).toContain('shadow-md')
  })

  it('IF-6 alt / src 透传', () => {
    const wrapper = mount(ImageFade, {
      props: { src: '/x.jpg', alt: 'hello world' }
    })
    const img = wrapper.find('img')
    expect(img.attributes('src')).toBe('/x.jpg')
    expect(img.attributes('alt')).toBe('hello world')
  })
})
