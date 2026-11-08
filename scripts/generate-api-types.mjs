#!/usr/bin/env node

/**
 * 从 OpenAPI 文档生成前端可用的 TypeScript 类型声明（src/types/api.d.ts）。
 *
 * 为什么生成 .d.ts（项目本体是 JS，不是 TS）：
 *   - JS 项目里 .d.ts 也能用：编辑器读它 → 写 `/** @type {import('@/types/api').Product} *\/`
 *     就能拿到字段补全与拼写检查 —— 这是纯 JS 项目能拿到的"类型系统"
 *   - 不引入编译步骤，不改构建流程，不影响产物
 *   - 类型永远由 OpenAPI 派生 → 文档改了类型跟着改，不会漂移
 *
 * 生成规则：
 *   JSON Schema type → TS type
 *     object → { ...props }
 *     array  → T[]
 *     string → string（带 enum → 联合字面量）
 *     integer/number → number
 *     boolean → boolean
 *   $ref → 引用已生成的 interface
 *   nullable: true → | null
 *   required 决定可选性（? 后缀）
 *
 * 用法：
 *   npm run gen:types          # 生成
 *   npm run gen:types -- --check   # 只检查是否与 OpenAPI 一致（CI 用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OPENAPI_FILE = path.join(ROOT, 'docs/openapi.json')
const OUT_FILE = path.join(ROOT, 'src/types/api.d.ts')

if (!fs.existsSync(OPENAPI_FILE)) {
  console.error('❌ 找不到 docs/openapi.json —— 先跑 npm run gen:openapi')
  process.exit(1)
}

const doc = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'))
const schemas = doc.components?.schemas || {}

/** 需要跳过的 schema（不作为 interface 导出） */
const SKIP = new Set(['ErrorEnvelope', 'SuccessEnvelope'])

/** TS 保留字 / 非法属性名 → 加引号 */
function safeKey (key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${key.replace(/'/g, "\\'")}'`
}

/**
 * allOf 的处理：
 *   - 单个 $ref + 内联对象 → `interface X extends Ref { ... }`（继承，最易读）
 *   - 其他情况 → `type X = A & B`（交叉类型）
 * @returns {{kind: 'extends'|'type', base: string, body: string}}
 */
function parseAllOf (allOf) {
  const refs = []
  const inlines = []
  for (const part of allOf) {
    if (part?.$ref) refs.push(part.$ref.split('/').pop())
    else inlines.push(part)
  }
  if (refs.length === 1 && inlines.length === 1) {
    return { kind: 'extends', base: refs[0], body: tsType(inlines[0], '') }
  }
  if (refs.length === 1 && inlines.length === 0) {
    return { kind: 'extends', base: refs[0], body: '{ [k: string]: unknown }' }
  }
  // 多个交叉：用 type 别名
  const parts = allOf.map(s => tsType(s, ''))
  return { kind: 'type', base: null, body: parts.join(' & ') }
}

/**
 * JSON Schema → TS 类型字符串
 * @param {object} schema
 * @param {string} indent 缩进
 */
function tsType (schema, indent = '  ') {
  if (!schema || typeof schema !== 'object') return 'unknown'

  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()
    return name
  }
  if (schema.anyOf) {
    return schema.anyOf.map(s => tsType(s, indent)).join(' | ')
  }
  if (schema.oneOf) {
    return schema.oneOf.map(s => tsType(s, indent)).join(' | ')
  }
  if (schema.allOf) {
    return parseAllOf(schema.allOf).body
  }

  let base
  switch (schema.type) {
    case 'object': {
      const props = schema.properties || {}
      const required = new Set(schema.required || [])
      const entries = Object.entries(props)
      if (entries.length === 0) {
        base = 'Record<string, unknown>'
      } else {
        const inner = indent + '  '
        const lines = entries.map(([key, value]) => {
          const opt = required.has(key) ? '' : '?'
          return `${inner}${safeKey(key)}${opt}: ${tsType(value, inner)}`
        })
        base = `{\n${lines.join('\n')}\n${indent}}`
      }
      break
    }
    case 'array': {
      base = `${tsType(schema.items || {}, indent)}[]`
      break
    }
    case 'string': {
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        base = schema.enum.map(v => JSON.stringify(v)).join(' | ')
      } else {
        base = 'string'
      }
      break
    }
    case 'integer':
    case 'number':
      base = 'number'
      break
    case 'boolean':
      base = 'boolean'
      break
    case 'null':
      base = 'null'
      break
    default:
      base = 'unknown'
  }

  if (schema.nullable) base = `${base} | null`
  return base
}

/** interface 名 → 合法标识符 */
function ifaceName (name) {
  return name.replace(/[^A-Za-z0-9_$]/g, '_')
}

const lines = []
lines.push('/**')
lines.push(' * 自动生成的 API 类型声明 —— 请勿手改。')
lines.push(' *')
lines.push(' * 来源：docs/openapi.json（由 scripts/generate-openapi.mjs 从 Express 路由表')
lines.push(' * + Sequelize 模型生成）。重新生成：npm run gen:openapi && npm run gen:types')
lines.push(' *')
lines.push(' * 本项目是 JS，用 JSDoc 引用即可获得字段补全：')
lines.push(' *   在 .js 文件里写 @type {import(\'@/types/api\').Product} 标注变量')
lines.push(' */')
lines.push('')

for (const [name, schema] of Object.entries(schemas)) {
  if (SKIP.has(name)) continue
  const desc = schema.description ? ` * ${schema.description}` : null
  lines.push('/**')
  if (desc) lines.push(desc)
  lines.push(' */')
  // allOf → 继承 / 交叉类型；其余 → 普通 interface
  if (Array.isArray(schema.allOf)) {
    const parsed = parseAllOf(schema.allOf)
    if (parsed.kind === 'extends') {
      lines.push(`export interface ${ifaceName(name)} extends ${parsed.base} ${parsed.body}`)
    } else {
      lines.push(`export type ${ifaceName(name)} = ${parsed.body}`)
    }
  } else {
    lines.push(`export interface ${ifaceName(name)} ${tsType(schema, '')}`)
  }
  lines.push('')
}

// 常用组合类型：把响应信封也导出，前端解包时用得上
lines.push('/**')
lines.push(' * 统一响应信封（所有接口都返回这个形状）')
lines.push(' * @template T 数据类型')
lines.push(' */')
lines.push('export interface ApiEnvelope<T = unknown> {')
lines.push('  success: boolean')
lines.push('  message: string')
lines.push('  code?: string')
lines.push('  data?: T')
lines.push('}')
lines.push('')

const out = lines.join('\n')

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : ''
  if (existing !== out) {
    console.error('❌ src/types/api.d.ts 与 docs/openapi.json 不一致 —— 请运行 npm run gen:types')
    process.exit(1)
  }
  console.log('✅ src/types/api.d.ts 与 docs/openapi.json 一致')
} else {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, out, 'utf8')
  const count = Object.keys(schemas).filter(n => !SKIP.has(n)).length
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT_FILE)}（${count} 个类型）`)
}
