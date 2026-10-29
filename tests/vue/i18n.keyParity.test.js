/**
 * i18n 语言包键集一致性（3 用例）
 *
 * 三端各语言包（zh-CN / en-US / th-TH）必须键集完全一致：
 * 缺失的键在 vue-i18n 里会直接渲染原始键名（如 'user.passwordPolicyHint'），
 * 用户看到的是机器标识而非文案。
 *
 * 历史问题：portal 的 en-US 比 zh-CN/th-TH 多 39 个键（en 后期单独补，
 * zh/th 未回填）；另有 t() 引用了不存在的 'user.passwordPolicyHint'。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

/** 递归展开嵌套对象为扁平点路径 */
function flatten (obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key))
    else out[key] = v
  }
  return out
}

/** 从语言包源码里解析出默认导出的对象（避免 import 触发运行时依赖） */
function loadLocale (file) {
  const src = fs.readFileSync(file, 'utf8')
  // 去掉 import/export 包装，取 export default {...}
  const m = src.match(/export\s+default\s+([\s\S]*?)\n\}/)
  if (!m) throw new Error(`无法解析 ${file}`)
  // eslint-disable-next-line no-new-func
  const obj = new Function(`return (${m[1].trim()}\n})`)()
  return flatten(obj)
}

const APPS = [
  { app: 'portal', dir: 'src/portal/i18n' },
  { app: 'admin', dir: 'src/admin/i18n' },
  { app: 'partner', dir: 'src/partner/i18n' }
]
const LOCALES = ['zh-CN.js', 'en-US.js', 'th-TH.js']

describe('i18n.keyParity', () => {
  for (const { app, dir } of APPS) {
    it(`KP-${app} 三语言键集完全一致`, () => {
      const sets = LOCALES.map(file => ({
        file,
        keys: loadLocale(path.join(ROOT, dir, file))
      }))
      const base = sets[0]
      for (const other of sets.slice(1)) {
        const missing = Object.keys(base.keys).filter(k => !(k in other.keys))
        const extra = Object.keys(other.keys).filter(k => !(k in base.keys))
        expect(
          { file: other.file, missing, extra },
          `${app}/${other.file} 与 ${base.file} 键集不一致`
        ).toEqual({ file: other.file, missing: [], extra: [] })
      }
    })
  }
})
