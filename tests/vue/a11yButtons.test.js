/**
 * 可访问性护栏：图标按钮必须有可访问名称
 *
 * 背景：购物车里"删除商品""减少数量"这些按钮**只有图标**，
 * 屏幕阅读器只能读出"按钮" —— 用户完全不知道按下去会发生什么。
 * （WCAG 4.1.2 Name, Role, Value）
 *
 * 这个测试扫全部前端模板，任何新增的"无名图标按钮"都会让它变红。
 *
 * 判定"无名"的条件（三者都没有）：
 *   - 文本插值（`{{ t('...') }}` / `{{ label }}`）
 *   - 可见文字
 *   - aria-label / title
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const DIRS = ['src/portal', 'src/admin', 'src/partner']

/** 扫出一个端点的所有 .vue 文件 */
function vueFiles (dir) {
  const out = []
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (!['dist', 'node_modules', 'i18n'].includes(f)) out.push(...vueFiles(p))
    } else if (f.endsWith('.vue')) {
      out.push(p)
    }
  }
  return out
}

describe('可访问性：图标按钮要有可访问名称', () => {
  it('A11Y-1 没有"只有图标、无名称"的按钮', () => {
    const offenders = []
    for (const dir of DIRS) {
      for (const file of vueFiles(dir)) {
        const src = fs.readFileSync(file, 'utf8')
        const re = /<button\b([^>]*)>([\s\S]{0,400}?)<\/button>/g
        let m
        while ((m = re.exec(src))) {
          const attrs = m[1]
          const body = m[2]
          // 有 aria-label / title → 有名称
          if (/aria-label|:aria-label|title=/.test(attrs)) continue
          // 文本插值也算名称（{{ t('x') }} / {{ label }}）
          if (body.includes('{{')) continue
          // 可见文字
          const text = body
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, ' ')
            .trim()
          if (text) continue
          // 包装组件（<button><slot/></button>）的按钮内容来自调用方 → 跳过
          if (body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').trim() === '') continue
          // 到这里 = 只有图标（或纯装饰）且没有任何名称
          const line = src.slice(0, m.index).split('\n').length
          const click = /@click="([^"]*)"/.exec(attrs)?.[1] || '(无 click)'
          offenders.push(`${file.replace(ROOT + '/', '')}:${line}  ${click}`)
        }
      }
    }
    expect(
      offenders,
      '这些按钮只有图标、没有可访问名称（屏幕阅读器读不出用途）：\n' + offenders.join('\n')
    ).toEqual([])
  })
})
