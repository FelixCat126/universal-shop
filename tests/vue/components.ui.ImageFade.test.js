/**
 * VC-ImageFade — 图片 fade-in
 *
 * 覆盖：
 *   IF-1 初始 ui-img-fade，无 is-loaded
 *   IF-2 load 事件后 is-loaded class
 *   IF-3 error 事件后也 is-loaded（兜底，不一直空白）
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

  it('IF-3 error 事件后也 is-loaded（兜底）', async () => {
    const wrapper = mount(ImageFade, { props: { src: '/x.jpg' } })
    await wrapper.find('img').trigger('error')
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
