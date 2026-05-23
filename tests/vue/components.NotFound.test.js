/**
 * VC-NotFound — 404 页面 i18n 完整性 + 跳转
 *   覆盖：
 *     NF-1 渲染 zh-CN：标题/描述/按钮使用 i18n key
 *     NF-2 切换 en-US：文本变更
 *     NF-3 点击「返回首页」 → router.push name=Home
 *     NF-4 点击「返回」 → router.back()
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NotFound from '@portal/views/NotFound.vue'

const messages = {
  'zh-CN': {
    error: { notFound: '页面未找到', notFoundDesc: '您访问的页面不存在' },
    common: { home: '返回首页', back: '返回' }
  },
  'en-US': {
    error: { notFound: 'Page Not Found', notFoundDesc: 'The page you visit does not exist' },
    common: { home: 'Home', back: 'Back' }
  }
}

function makeI18n (locale = 'zh-CN') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'zh-CN', messages })
}

function makeRouterStub () {
  return {
    push: vi.fn(),
    back: vi.fn()
  }
}

function mountNF (locale = 'zh-CN') {
  const router = makeRouterStub()
  const i18n = makeI18n(locale)
  const wrapper = mount(NotFound, {
    global: {
      plugins: [i18n],
      mocks: { $router: router },
      stubs: { ExclamationTriangleIcon: true }
    }
  })
  return { wrapper, router }
}

describe('VC.components.NotFound', () => {
  it('NF-1 zh-CN i18n 渲染正确', () => {
    const { wrapper } = mountNF('zh-CN')
    expect(wrapper.text()).toContain('页面未找到')
    expect(wrapper.text()).toContain('您访问的页面不存在')
    expect(wrapper.text()).toContain('返回首页')
    expect(wrapper.text()).toContain('返回')
  })

  it('NF-2 en-US 切语言后文本变化', () => {
    const { wrapper } = mountNF('en-US')
    expect(wrapper.text()).toContain('Page Not Found')
    expect(wrapper.text()).toContain('Home')
    expect(wrapper.text()).not.toContain('返回首页')
  })

  it('NF-3 点击「返回首页」', async () => {
    const { wrapper, router } = mountNF()
    const homeBtn = wrapper.findAll('button').find((b) => b.text().includes('返回首页'))
    await homeBtn.trigger('click')
    expect(router.push).toHaveBeenCalledWith({ name: 'Home' })
  })

  it('NF-4 点击「返回」', async () => {
    const { wrapper, router } = mountNF()
    const backBtn = wrapper.findAll('button').find((b) => b.text() === '返回')
    await backBtn.trigger('click')
    expect(router.back).toHaveBeenCalled()
  })
})
