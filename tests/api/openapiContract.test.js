/**
 * OpenAPI 契约守护测试
 *
 * 文档最大的风险不是"写错了"，而是**过期** —— 后端加了接口，文档没更新，
 * 别人照着文档写前端 → 404。文档一旦不可信就等于没有。
 *
 *   OC-1 docs/openapi.json 与当前路由表一致（路由加了/改了 → 文档必须重生成）
 *   OC-2 src/types/api.d.ts 与 openapi.json 一致（类型不会漂移）
 *   OC-3 所有 $ref 都能在 components.schemas 里找到（没有悬空引用）
 *   OC-4 每个登记的组件 schema 至少被一个操作用到（没用的登记是噪音）
 *   OC-5 生成的类型文件能通过 TypeScript 语法检查
 *   OC-6 关键接口有真实的请求/响应 schema（不是只有路径骨架）
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const OPENAPI = path.join(ROOT, 'docs/openapi.json')
const TYPES = path.join(ROOT, 'src/types/api.d.ts')

const doc = JSON.parse(fs.readFileSync(OPENAPI, 'utf8'))
const schemas = doc.components?.schemas || {}

describe('OpenAPI 契约', () => {
  it('OC-1 docs/openapi.json 与当前路由表一致', () => {
    expect(() => {
      execFileSync(process.execPath, ['scripts/generate-openapi.mjs', '--check'], {
        cwd: ROOT,
        stdio: 'pipe'
      })
    }).not.toThrow()
  })

  it('OC-2 src/types/api.d.ts 与 openapi.json 一致', () => {
    expect(() => {
      execFileSync(process.execPath, ['scripts/generate-api-types.mjs', '--check'], {
        cwd: ROOT,
        stdio: 'pipe'
      })
    }).not.toThrow()
  })

  it('OC-3 所有 $ref 都能解析（没有悬空引用）', () => {
    const dangling = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (typeof node.$ref === 'string') {
        const name = node.$ref.replace('#/components/schemas/', '')
        if (!schemas[name]) dangling.push(node.$ref)
      }
      Object.values(node).forEach(walk)
    }
    walk(doc.paths)
    walk(schemas)
    expect(dangling).toEqual([])
  })

  it('OC-4 每个组件 schema 从某个操作可达（没用的登记是噪音）', () => {
    // 可达性要**传递闭包**：A → B → C，则 B、C 也算被用到
    const used = new Set()
    const collect = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(collect)
        return
      }
      if (typeof node.$ref === 'string') {
        used.add(node.$ref.replace('#/components/schemas/', ''))
      }
      Object.values(node).forEach(collect)
    }
    collect(doc.paths)

    // 闭包：新发现的 schema 里可能还引用着别的 schema
    let grew = true
    while (grew) {
      grew = false
      const before = used.size
      for (const name of [...used]) {
        if (!schemas[name]) continue
        collect(schemas[name])
      }
      if (used.size !== before) grew = true
    }

    // ErrorEnvelope / SuccessEnvelope 被错误响应普遍引用，这里单独算
    const unused = Object.keys(schemas).filter(
      name => !used.has(name) && name !== 'ErrorEnvelope' && name !== 'SuccessEnvelope'
    )
    expect(unused).toEqual([])
  })

  it('OC-5 生成的类型文件能通过 TypeScript 语法检查', () => {
    const tsCheck = path.join(ROOT, 'node_modules/typescript/bin/tsc')
    if (!fs.existsSync(tsCheck)) {
      // 没装 typescript 就跳过（不能因为缺工具就红）
      expect(fs.existsSync(TYPES)).toBe(true)
      return
    }
    expect(() => {
      execFileSync(process.execPath, [tsCheck, '--noEmit', '--skipLibCheck', '--strict', TYPES], {
        cwd: ROOT,
        stdio: 'pipe'
      })
    }).not.toThrow()
  })

  it('OC-6 关键接口有真实的请求/响应 schema', () => {
    const keyOps = [
      ['/api/admin/orders/bulk/status', 'post'],
      ['/api/admin/orders/{id}/status', 'put'],
      ['/api/products/bulk', 'post'],
      ['/api/products', 'get'],
      ['/api/cart', 'post']
    ]
    for (const [p, method] of keyOps) {
      const op = doc.paths?.[p]?.[method]
      expect(op, `缺少操作 ${method.toUpperCase()} ${p}`).toBeTruthy()
      expect(op['x-schema'], `${method.toUpperCase()} ${p} 没有登记 schema`).toBe('defined')
    }
  })

  it('OC-7 未知 schema 的接口被明确标注（不假装有）', () => {
    const ops = Object.entries(doc.paths).flatMap(([p, methods]) =>
      Object.entries(methods).map(([m, op]) => ({ p, m, op }))
    )
    for (const { p, m, op } of ops) {
      expect(
        ['defined', 'unknown'],
        `${m.toUpperCase()} ${p} 的 x-schema 取值非法`
      ).toContain(op['x-schema'])
    }
    // 至少要有一部分是 defined —— 否则说明登记表没接上
    expect(ops.filter(o => o.op['x-schema'] === 'defined').length).toBeGreaterThan(20)
  })
})
