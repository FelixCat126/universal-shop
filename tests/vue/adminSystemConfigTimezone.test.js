/**
 * 管理端「业务时区」卡片的护栏
 *
 * 按项目约定（admin.Dashboard.test.js）：Element Plus 太重，**不 mount**整个页面，
 * 改为「导入组件（这一步会真的编译模板）+ 校验关键结构」。
 *
 * 覆盖：
 *   SC-1 组件能编译（模板语法错误会在这里暴露）
 *   SC-2 卡片存在且绑到 businessTimezone / saveBusinessTimezone
 *   SC-3 三种语言都有这 8 个键，且文案非空
 *   SC-4 下拉里带常用时区（含 Asia/Bangkok / Asia/Shanghai）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('管理端业务时区卡片', () => {
  it('SC-1 SystemConfig.vue 能正常编译（模板语法错误会在这里暴露）', async () => {
    const mod = await import('@admin/views/SystemConfig.vue')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default).toBe('object')
  })

  it('SC-2 卡片存在且绑定正确', () => {
    const src = read('src/admin/views/SystemConfig.vue')
    expect(src).toContain('systemConfig.businessTimezone')
    expect(src).toContain('v-model="businessTimezone"')
    expect(src).toContain('@click="saveBusinessTimezone"')
    expect(src).toContain('saveBusinessTimezone')
    // 保存的 key 必须是后端认的那个
    expect(src).toContain("key: 'business_timezone'")
  })

  it('SC-3 三种语言都有这 8 个键且文案非空', () => {
    const keys = [
      'businessTimezone',
      'businessTimezoneSubtitle',
      'businessTimezonePlaceholder',
      'saveBusinessTimezone',
      'businessTimezoneTips'
    ]
    const msgKeys = [
      'businessTimezoneSaveSuccess',
      'businessTimezoneSaveFailed',
      'invalidBusinessTimezone'
    ]
    for (const locale of ['zh-CN', 'en-US', 'th-TH']) {
      const src = read(`src/admin/i18n/${locale}.js`)
      for (const k of [...keys, ...msgKeys]) {
        const re = new RegExp(`${k}:\\s*'([^']*)'`)
        const m = re.exec(src)
        expect(m, `${locale} 缺少文案键 ${k}`).not.toBeNull()
        expect(m[1].trim(), `${locale}.${k} 文案为空`).not.toBe('')
      }
    }
  })

  it('SC-4 下拉带常用时区', () => {
    const src = read('src/admin/views/SystemConfig.vue')
    expect(src).toContain('commonTimezones')
    expect(src).toContain("'Asia/Shanghai'")
    expect(src).toContain("'Asia/Bangkok'")
    expect(src).toContain("'UTC'")
  })
})
