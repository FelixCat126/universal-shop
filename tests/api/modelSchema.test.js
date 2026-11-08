/**
 * 模型 → JSON Schema 推导测试
 *
 * 这段代码决定了 OpenAPI 文档里"字段长什么样"。它错了不会报错，
 * 只会在文档里安静地写出错误的类型 —— 而文档错了别人就会照着写错。
 *
 *   MS-1 基本映射：属性名、类型、必填
 *   MS-2 ENUM → enum 取值列表
 *   MS-3 comment → description
 *   MS-4 数组 → items
 *   MS-5 DECIMAL 精度 → multipleOf
 *   MS-6 allowNull → nullable
 *   MS-7 include / exclude 过滤
 *   MS-8 信封包装（success/message/data）
 *   MS-9 边界：空模型不崩
 */
import { describe, it, expect } from 'vitest'
import {
  modelToSchema,
  envelopeSchema,
  pagedEnvelopeSchema,
  enumSchema
} from '@server/utils/modelSchema.js'
import Product from '@server/models/Product.js'
import Order from '@server/models/Order.js'

describe('模型 → JSON Schema 推导', () => {
  it('MS-1 基本映射：属性名、类型、必填', () => {
    const schema = modelToSchema(Product, { name: 'Product' })
    expect(schema.type).toBe('object')
    expect(schema.title).toBe('Product')
    expect(schema.properties.id).toBeTruthy()
    expect(schema.properties.id.type).toBe('integer')
    expect(schema.properties.name.type).toBe('string')
    expect(schema.properties.price.type).toBe('number')
    expect(schema.properties.stock.type).toBe('integer')
    expect(schema.required).toContain('name')
    expect(schema.required).not.toContain('alias')
  })

  it('MS-2 ENUM → enum 取值列表', () => {
    const schema = modelToSchema(Product, { name: 'Product' })
    expect(schema.properties.status.enum).toEqual(['active', 'inactive'])
  })

  it('MS-3 comment → description', () => {
    const schema = modelToSchema(Order, { name: 'Order' })
    expect(schema.properties.tracking_number.description).toMatch(/物流单号/)
    expect(schema.properties.order_no.description).toMatch(/订单号/)
  })

  it('MS-4 数组 → items', () => {
    // 直接构造一个带数组属性的假模型
    const fake = {
      rawAttributes: {
        tags: {
          type: { key: 'ARRAY', options: { type: { key: 'STRING', options: {} } } },
          allowNull: true
        }
      }
    }
    const schema = modelToSchema(fake, { name: 'Fake' })
    expect(schema.properties.tags.type).toBe('array')
    expect(schema.properties.tags.items.type).toBe('string')
  })

  it('MS-5 DECIMAL 精度 → multipleOf', () => {
    const schema = modelToSchema(Order, { name: 'Order' })
    expect(schema.properties.total_amount.multipleOf).toBe(0.01)
  })

  it('MS-6 allowNull → nullable', () => {
    const schema = modelToSchema(Order, { name: 'Order' })
    expect(schema.properties.tracking_number.nullable).toBe(true)
    expect(schema.properties.order_no.nullable).toBeUndefined()
  })

  it('MS-7 include / exclude 过滤', () => {
    const only = modelToSchema(Product, { name: 'P', include: ['id', 'name'] })
    expect(Object.keys(only.properties)).toEqual(['id', 'name'])

    const without = modelToSchema(Product, { name: 'P', exclude: ['deleted_at'] })
    expect(without.properties.deleted_at).toBeUndefined()
    expect(without.properties.name).toBeTruthy()
  })

  it('MS-8 信封包装（success/message/data）', () => {
    const env = envelopeSchema({ type: 'string' })
    expect(env.properties.success.type).toBe('boolean')
    expect(env.properties.message.type).toBe('string')
    expect(env.properties.data.type).toBe('string')
    expect(env.required).toContain('success')
    expect(env.required).toContain('message')

    const paged = pagedEnvelopeSchema({ type: 'object' })
    expect(paged.properties.data.properties.list.type).toBe('array')
    expect(paged.properties.data.properties.pagination.properties.total.type).toBe('integer')
  })

  it('MS-9 边界：空模型不崩', () => {
    const schema = modelToSchema({ rawAttributes: {} }, { name: 'Empty' })
    expect(schema.properties).toEqual({})
    expect(schema.required).toBeUndefined()
  })

  it('MS-10 enumSchema 生成枚举 schema', () => {
    const s = enumSchema(['a', 'b'])
    expect(s.type).toBe('string')
    expect(s.enum).toEqual(['a', 'b'])
  })

  it('MS-11 未知类型不会崩（回落成 string）', () => {
    const fake = {
      rawAttributes: {
        weird: { type: { key: 'SOMETHING_NEW' }, allowNull: true }
      }
    }
    const schema = modelToSchema(fake, { name: 'Fake' })
    expect(schema.properties.weird.type).toBe('string')
  })
})
