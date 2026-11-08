/**
 * 路由 schema 登记表测试
 *
 * 登记表里的每一条都对应一个**真实存在的路由** —— 如果路由改名/删除，
 * 登记就会失效（文档里出现"描述了一个不存在的接口"）。
 * 而且登记的路径写错时，文档会静默地不生效（x-schema 变成 unknown），
 * 所以要拿真实路由表来核对。
 *
 *   RS-1 每条登记的路由都真实存在
 *   RS-2 关键路由都登记了（不能大面积 unknown）
 *   RS-3 登记项结构合法（有 request/response 且是对象）
 *   RS-4 组件 schema 命名规范
 *   RS-5 请求体 schema 的必填字段都存在
 */
import { describe, it, expect } from 'vitest'
import app from '@server/app.js'
import { collectRoutes } from '@server/utils/routeInventory.js'
import { COMPONENT_SCHEMAS, ROUTE_SCHEMAS } from '@server/utils/routeSchemas.js'

const routes = collectRoutes(app)
const routeKeys = new Set(routes.map(r => `${r.method} ${r.fullPath}`))

describe('路由 schema 登记表', () => {
  it('RS-1 每条登记的路由都真实存在', () => {
    const missing = Object.keys(ROUTE_SCHEMAS).filter(k => !routeKeys.has(k))
    expect(missing, `登记了不存在的路由：\n${missing.join('\n')}`).toEqual([])
  })

  it('RS-2 关键路由都登记了（不能大面积 unknown）', () => {
    const key = [
      'GET /api/products',
      'GET /api/products/:id',
      'POST /api/products/bulk',
      'GET /api/orders',
      'POST /api/orders',
      'GET /api/admin/orders',
      'PUT /api/admin/orders/:id/status',
      'POST /api/admin/orders/bulk/status',
      'GET /api/cart',
      'POST /api/cart',
      'GET /api/addresses',
      'GET /api/partner/orders',
      'GET /api/admin/export/jobs'
    ]
    const missing = key.filter(k => !ROUTE_SCHEMAS[k])
    expect(missing, `关键路由没登记：\n${missing.join('\n')}`).toEqual([])
  })

  it('RS-3 登记项结构合法', () => {
    for (const [key, entry] of Object.entries(ROUTE_SCHEMAS)) {
      expect(typeof entry, key).toBe('object')
      for (const field of ['request', 'response']) {
        if (entry[field] === undefined) continue
        expect(typeof entry[field], `${key}.${field}`).toBe('object')
      }
      // 至少要有一项
      expect(entry.request || entry.response, `${key} 两项都没有`).toBeTruthy()
    }
  })

  it('RS-4 组件 schema 命名规范（大驼峰、无空格）', () => {
    for (const name of Object.keys(COMPONENT_SCHEMAS)) {
      expect(name, `schema 名不规范：${name}`).toMatch(/^[A-Z][A-Za-z0-9]*$/)
    }
  })

  it('RS-5 登记里的 $ref 都能在组件里找到', () => {
    const dangling = []
    const walk = (node, where) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(n => walk(n, where))
        return
      }
      if (typeof node.$ref === 'string') {
        const name = node.$ref.replace('#/components/schemas/', '')
        if (!COMPONENT_SCHEMAS[name]) dangling.push(`${where} → ${name}`)
      }
      Object.values(node).forEach(n => walk(n, where))
    }
    for (const [key, entry] of Object.entries(ROUTE_SCHEMAS)) {
      walk(entry.request, key)
      walk(entry.response, key)
    }
    expect(dangling, `悬空引用：\n${dangling.join('\n')}`).toEqual([])
  })

  it('RS-6 请求体 schema 的必填字段都真实存在', () => {
    for (const [key, entry] of Object.entries(ROUTE_SCHEMAS)) {
      const body = entry.request
      if (!body || !body.properties || !body.required) continue
      for (const field of body.required) {
        expect(body.properties[field], `${key} 必填字段 ${field} 没有定义`).toBeTruthy()
      }
    }
  })

  it('RS-7 组件 schema 都有 type 或 allOf（不能是空壳）', () => {
    for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
      const hasShape = schema.type || schema.allOf || schema.$ref || schema.properties
      expect(hasShape, `${name} 是空壳`).toBeTruthy()
    }
  })
})
