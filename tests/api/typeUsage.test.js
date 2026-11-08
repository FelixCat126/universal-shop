/**
 * 生成的前端类型必须**真的被用上**，而且引用的名字必须存在。
 *
 * 类型声明如果没人引用，就是纯装饰 —— 改模型时不会有人被提醒，
 * 下次 schema 变了前端还是按老字段写 —— 悄悄坏掉。
 *
 *   TU-1 前端 JSDoc 里引用的类型名都在 src/types/api.d.ts 里存在
 *   TU-2 前端至少有一处真的引用了生成类型（不是空壳）
 *   TU-3 引用方式用相对路径（不依赖构建别名，纯编辑器也能解析）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const TYPES_FILE = path.join(ROOT, 'src/types/api.d.ts')
const FRONTEND_DIRS = ['src/admin', 'src/portal', 'src/partner', 'src/utils']

/** 递归收集 js/vue 文件 */
function collectFiles (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectFiles(full, acc)
    } else if (/\.(js|vue)$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

describe('生成类型的实际使用', () => {
  it('TU-1 前端引用的类型名都存在', () => {
    const typesSrc = fs.readFileSync(TYPES_FILE, 'utf8')
    const exported = new Set()
    for (const m of typesSrc.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
      exported.add(m[1])
    }
    expect(exported.size).toBeGreaterThan(10)

    // import('...types/api').TypeName
    const refRe = /import\(['"][^'"]*types\/api['"]\)\.([A-Za-z_$][\w$]*)/g
    const missing = []
    const used = new Set()
    for (const dir of FRONTEND_DIRS) {
      for (const file of collectFiles(path.join(ROOT, dir))) {
        const src = fs.readFileSync(file, 'utf8')
        for (const m of src.matchAll(refRe)) {
          used.add(m[1])
          if (!exported.has(m[1])) {
            missing.push(`${path.relative(ROOT, file)} → ${m[1]}`)
          }
        }
      }
    }
    expect(missing, `引用了不存在的类型：\n${missing.join('\n')}`).toEqual([])
    expect(used.size).toBeGreaterThan(0)
  })

  it('TU-2 前端至少有一处真的引用了生成类型', () => {
    const refRe = /import\(['"][^'"]*types\/api['"]\)\.([A-Za-z_$][\w$]*)/g
    let count = 0
    for (const dir of FRONTEND_DIRS) {
      for (const file of collectFiles(path.join(ROOT, dir))) {
        const src = fs.readFileSync(file, 'utf8')
        count += [...src.matchAll(refRe)].length
      }
    }
    expect(count, '前端一处都没用生成类型 —— 类型就是摆设').toBeGreaterThan(0)
  })

  it('TU-3 引用用相对路径（纯编辑器也能解析，不依赖构建别名）', () => {
    const refRe = /import\(['"]([^'"]*types\/api)['"]\)/g
    const bad = []
    for (const dir of FRONTEND_DIRS) {
      for (const file of collectFiles(path.join(ROOT, dir))) {
        const src = fs.readFileSync(file, 'utf8')
        for (const m of src.matchAll(refRe)) {
          const spec = m[1]
          if (spec.startsWith('@') || spec.startsWith('~')) {
            bad.push(`${path.relative(ROOT, file)} → ${spec}`)
          }
        }
      }
    }
    expect(bad, `这些引用依赖构建别名：\n${bad.join('\n')}`).toEqual([])
  })

  it('TU-4 类型文件里的每个导出都被前端用到（避免类型堆积没人管）', () => {
    const typesSrc = fs.readFileSync(TYPES_FILE, 'utf8')
    const exported = [...typesSrc.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)]
      .map(m => m[1])
      .filter(n => n !== 'ApiEnvelope')

    const refRe = /import\(['"][^'"]*types\/api['"]\)\.([A-Za-z_$][\w$]*)/g
    const used = new Set()
    for (const dir of FRONTEND_DIRS) {
      for (const file of collectFiles(path.join(ROOT, dir))) {
        const src = fs.readFileSync(file, 'utf8')
        for (const m of src.matchAll(refRe)) used.add(m[1])
      }
    }

    // 允许一部分类型暂时没人用（它们是给后续接入准备的），
    // 但不能堆积太多 —— 超过一半就说明该接进前端了
    const unused = exported.filter(n => !used.has(n))
    expect(unused.length, `未使用的类型：${unused.join(', ')}`).toBeLessThanOrEqual(
      Math.ceil(exported.length / 2)
    )
  })
})
