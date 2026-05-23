/**
 * VC-CountrySelector — 国家选择器
 *   覆盖：
 *     CS-1 默认渲染 3 个国家选项 + 默认值 +66
 *     CS-2 切换 +86 时 emit update:modelValue + country-change
 *     CS-3 disabled prop 生效
 *     CS-4 错误信息渲染
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CountrySelector from '@portal/components/CountrySelector.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      country: { thailand: '泰国', china: '中国', malaysia: '马来西亚' },
      common: { selectCountry: '请选择国家' }
    }
  }
})

function mountCS (props = {}) {
  return mount(CountrySelector, {
    props: { modelValue: '+66', ...props },
    global: { plugins: [i18n] }
  })
}

describe('VC.components.CountrySelector', () => {
  it('CS-1 渲染 3 个国家选项', () => {
    const w = mountCS()
    const opts = w.findAll('option').map((o) => o.text().trim())
    expect(opts.some((t) => t.includes('+66'))).toBe(true)
    expect(opts.some((t) => t.includes('+86'))).toBe(true)
    expect(opts.some((t) => t.includes('+60'))).toBe(true)
    expect(w.find('select').element.value).toBe('+66')
  })

  it('CS-2 切换为 +86 emit 双事件', async () => {
    const w = mountCS()
    await w.find('select').setValue('+86')
    expect(w.emitted('update:modelValue')[0]).toEqual(['+86'])
    expect(w.emitted('country-change')[0][0]).toMatchObject({
      code: '+86', flag: '🇨🇳'
    })
  })

  it('CS-3 disabled 生效', () => {
    const w = mountCS({ disabled: true })
    expect(w.find('select').attributes('disabled')).toBeDefined()
  })

  it('CS-4 error 文案展示', () => {
    const w = mountCS({ error: '请选择国家' })
    expect(w.text()).toContain('请选择国家')
    expect(w.find('.border-red-500').exists()).toBe(true)
  })
})
