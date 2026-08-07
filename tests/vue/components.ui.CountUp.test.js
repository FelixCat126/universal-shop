/**
 * VC-CountUp — 数字滚动动画
 *
 * 用真实定时器（短 duration）验证滚动行为。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CountUp from '@portal/components/ui/CountUp.vue'

async function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('VC.components.ui.CountUp', () => {
  it('CU-1 初始渲染显示 0', () => {
    const wrapper = mount(CountUp, { props: { value: 100 } })
    expect(wrapper.text()).toBe('0')
  })

  it('CU-2 从 0 滚到 100', async () => {
    const wrapper = mount(CountUp, { props: { value: 100, duration: 50 } })
    await sleep(80)
    expect(wrapper.text()).toBe('100')
  })

  it('CU-3 value 变化后从旧值滚到新值', async () => {
    const wrapper = mount(CountUp, { props: { value: 50, duration: 50 } })
    await sleep(80)
    expect(wrapper.text()).toBe('50')
    await wrapper.setProps({ value: 100, duration: 50 })
    await sleep(80)
    expect(wrapper.text()).toBe('100')
  })

  it('CU-4 decimals=2 保留小数', async () => {
    const wrapper = mount(CountUp, { props: { value: 12.345, decimals: 2, duration: 50 } })
    await sleep(80)
    expect(['12.34', '12.35']).toContain(wrapper.text())
  })

  it('CU-5 duration=0 立即显示', async () => {
    const wrapper = mount(CountUp, { props: { value: 999, duration: 0 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('999')
  })

  it('CU-6 value 非数字 → 视为 0', async () => {
    const wrapper = mount(CountUp, { props: { value: 'abc', duration: 50 } })
    await sleep(80)
    expect(wrapper.text()).toBe('0')
  })

  it('CU-7 卸载时不抛错', () => {
    const wrapper = mount(CountUp, { props: { value: 100, duration: 1000 } })
    wrapper.unmount()
    expect(true).toBe(true)
  })

  it('CU-8 tabular-nums class 始终存在', () => {
    const wrapper = mount(CountUp, { props: { value: 100 } })
    expect(wrapper.classes()).toContain('tabular-nums')
  })

  it('CU-9 减速曲线 ease-out（前 50% 进度比后 50% 快）', async () => {
    const wrapper = mount(CountUp, { props: { value: 100, duration: 100 } })
    await sleep(30)
    const first = parseFloat(wrapper.text())
    await sleep(30)
    const second = parseFloat(wrapper.text())
    await sleep(30)
    const third = parseFloat(wrapper.text())
    // ease-out：早期进度快
    expect(first).toBeGreaterThan(third - second)
  })

  it('CU-10 value 变化 < 1 时仍然滚动', async () => {
    const wrapper = mount(CountUp, { props: { value: 0, decimals: 0, duration: 50 } })
    await sleep(80)
    expect(wrapper.text()).toBe('0')
    await wrapper.setProps({ value: 1, duration: 50 })
    await sleep(80)
    expect(wrapper.text()).toBe('1')
  })
})
