/**
 * P5 输入校验中间件（10 用例）
 *
 * 覆盖 validate.js 的行为契约：
 *   - stripUnknown 删除未声明字段
 *   - convert: true 类型强制
 *   - abortEarly: false 聚合错误
 *   - body / query / params 三段独立
 *   - 各 schema 边界
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import Joi from 'joi'
import app from '@server/app.js'
import {
  validate,
  phoneSchema,
  countryCodeSchema,
  createOrderSchema,
  createPartnerOrderSchema,
  registerSchema,
  loginSchema
} from '@server/middlewares/validate.js'
import { TestDatabase } from '../setup/test-database.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
})

function makeApp (schemas) {
  const t = express()
  t.use(express.json())
  t.post('/x', validate(schemas), (req, res) => {
    res.json({ success: true, body: req.body, query: req.query, params: req.params })
  })
  return t
}

describe('P5-Supplement.validate', () => {
  it('V-1 stripUnknown 删除未声明字段', async () => {
    const t = makeApp({
      body: Joi.object({ a: Joi.string().required() })
    })
    const res = await request(t)
      .post('/x')
      .send({ a: 'hello', evil: 'injected', another: 'junk' })
    expect(res.status).toBe(200)
    expect(res.body.body).toEqual({ a: 'hello' })
    expect(res.body.body.evil).toBeUndefined()
    expect(res.body.body.another).toBeUndefined()
  })

  it('V-2 convert: true 字符串数字 → 数字', async () => {
    const t = makeApp({
      body: Joi.object({ n: Joi.number().integer().required() })
    })
    const res = await request(t)
      .post('/x')
      .send({ n: '42' })
    expect(res.status).toBe(200)
    expect(res.body.body.n).toBe(42)
  })

  it('V-3 abortEarly: false 聚合错误', async () => {
    const t = makeApp({
      body: Joi.object({
        a: Joi.string().required(),
        b: Joi.number().required()
      })
    })
    const res = await request(t)
      .post('/x')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
    // 应同时报 a 和 b
    expect(res.body.message).toContain('a')
    expect(res.body.message).toContain('b')
  })

  it('V-4 query 校验独立工作', async () => {
    const t = makeApp({
      query: Joi.object({ page: Joi.number().integer().min(1).default(1) })
    })
    const res = await request(t).post('/x?page=3').send({})
    expect(res.status).toBe(200)
    expect(res.body.query.page).toBe(3)
  })

  it('V-5 phoneSchema 边界', () => {
    expect(phoneSchema.validate('13800000000').error).toBeUndefined() // 11 位
    expect(phoneSchema.validate('12345678').error).toBeUndefined() // 8 位（最小）
    expect(phoneSchema.validate('123456789012345').error).toBeUndefined() // 15 位（最大）
    expect(phoneSchema.validate('1234567').error).toBeDefined() // 7 位过短
    expect(phoneSchema.validate('1234567890123456').error).toBeDefined() // 16 位超
    expect(phoneSchema.validate('0123').error).toBeDefined() // 0 开头拒
    expect(phoneSchema.validate('abc').error).toBeDefined() // 非数字
  })

  it('V-6 countryCodeSchema 白名单', () => {
    expect(countryCodeSchema.validate('+86').error).toBeUndefined()
    expect(countryCodeSchema.validate('+66').error).toBeUndefined()
    expect(countryCodeSchema.validate('+60').error).toBeUndefined()
    expect(countryCodeSchema.validate('+1').error).toBeDefined()
    expect(countryCodeSchema.validate('86').error).toBeDefined()
  })

  it('V-7 createOrderSchema referral_code 空字符串视为未填', () => {
    const r = createOrderSchema.validate({
      items: [{ product_id: 1, quantity: 1 }],
      contact_name: 'X',
      contact_phone: '13800000000',
      delivery_address: 'A',
      referral_code: ''
    })
    expect(r.error).toBeUndefined()
    expect(r.value.referral_code).toBeUndefined()
  })

  it('V-8 createPartnerOrderSchema items 上限 100', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ product_id: i + 1, quantity: 50 }))
    const r = createPartnerOrderSchema.validate({
      items,
      partner_address_id: 1
    })
    expect(r.error).toBeDefined()
  })

  it('V-9 createPartnerOrderSchema 缺 partner_address_id → 400', () => {
    const r = createPartnerOrderSchema.validate({
      items: [{ product_id: 1, quantity: 50 }]
    })
    expect(r.error).toBeDefined()
  })

  it('V-10 loginSchema 必须 email 或 phone 二选一', () => {
    const neither = loginSchema.validate({ password: 'x' })
    expect(neither.error).toBeDefined()
    const withPhone = loginSchema.validate({ phone: '13800000000', country_code: '+86', password: 'x' })
    expect(withPhone.error).toBeUndefined()
    const withEmail = loginSchema.validate({ email: 'a@b.com', password: 'x' })
    expect(withEmail.error).toBeUndefined()
  })
})
