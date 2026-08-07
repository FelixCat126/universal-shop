/**
 * VC-Ripple — 按钮涟漪
 *
 * 覆盖：
 *   RP-1 默认 type=button
 *   RP-2 type=submit 透传
 *   RP-3 disabled 透传
 *   RP-4 click 事件向上 emit
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Ripple from '@portal/components/ui/Ripple.vue'

describe('VC.components.ui.Ripple', () => {
  it('RP-1 默认 type=button', () => {
    const wrapper = mount(Ripple, { slots: { default: 'Click' } })
    expect(wrapper.find('button').attributes('type')).toBe('button')
  })

  it('RP-2 type=submit 透传', () => {
    const wrapper = mount(Ripple, { props: { type: 'submit' }, slots: { default: 'OK' } })
    expect(wrapper.find('button').attributes('type')).toBe('submit')
  })

  it('RP-3 disabled 透传', () => {
    const wrapper = mount(Ripple, { props: { disabled: true }, slots: { default: 'OK' } })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('RP-4 click 事件向上 emit', async () => {
    const wrapper = mount(Ripple, { slots: { default: 'OK' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toBeTruthy()
    expect(wrapper.emitted('click').length).toBe(1)
  })
})
