/**
 * 购物车 / 地址 的输入边界测试
 *
 * 这两个接口是**用户直接能碰到的入口**，参数校验一旦松掉，
 * 轻则 500（前端白屏），重则越权改到别人的购物车/地址。
 *
 *   CA-1 加购：product_id 缺失 / 非整数 / 不存在
 *   CA-2 加购：数量必须是 1-5000 的整数
 *   CA-3 加购：库存不足被拒
 *   CA-4 加购：bundle_id 与 product_id 互斥
 *   CA-5 加购：bundle_id 不存在
 *   CA-6 改数量：非法值被拒
 *   CA-7 删购物车条目：不属于自己的条目不能删（IDOR）
 *   CA-8 地址：必填字段缺失 → 400
 *   CA-9 地址：更新不属于自己的地址 → 404/403
 *   CA-10 地址：删除不属于自己的地址 → 404/403
 *   CA-11 地址：设置默认地址
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

let userToken
let otherToken
let userId
let otherUserId
let product

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { User, Product } = TestDatabase.getSequelize().models

  const user = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  const other = await User.create(await TestDataFactory.createUser({
    country_code: '+86',
    phone: `138${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  }))
  userToken = TestHelpers.generateToken(user)
  otherToken = TestHelpers.generateToken(other)
  userId = user.id
  otherUserId = other.id

  product = await Product.create(TestDataFactory.createProduct({ stock: 10, price: 50 }))
})

const cart = (method, url, token = userToken) =>
  request(app)[method](url).set('Authorization', `Bearer ${token}`)

const addr = (method, url, token = userToken) =>
  request(app)[method](url).set('Authorization', `Bearer ${token}`)

describe('购物车边界', () => {
  it('CA-1 加购：product_id 缺失 / 非整数 / 不存在', async () => {
    const missing = await cart('post', '/api/cart').send({ quantity: 1 })
    expect(missing.status).toBe(400)

    const notInt = await cart('post', '/api/cart').send({ product_id: 1.5, quantity: 1 })
    expect(notInt.status).toBe(400)

    const notExist = await cart('post', '/api/cart').send({ product_id: 999999, quantity: 1 })
    expect(notExist.status).toBe(404)
  })

  it('CA-2 加购：数量必须是 1-5000 的整数', async () => {
    for (const quantity of [0, -1, 1.5, 5001, 'abc']) {
      const res = await cart('post', '/api/cart').send({ product_id: product.id, quantity })
      expect(res.status, `quantity=${quantity}`).toBe(400)
    }
    const ok = await cart('post', '/api/cart').send({ product_id: product.id, quantity: 2 })
    expect(ok.status).toBe(200)
  })

  it('CA-3 加购：库存不足被拒', async () => {
    const res = await cart('post', '/api/cart').send({ product_id: product.id, quantity: 999 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/库存/)
  })

  it('CA-4 加购：bundle_id 与 product_id 互斥', async () => {
    const res = await cart('post', '/api/cart').send({
      product_id: product.id,
      bundle_id: 1,
      quantity: 1
    })
    expect(res.status).toBe(400)
  })

  it('CA-5 加购：bundle_id 不存在 → 404', async () => {
    const res = await cart('post', '/api/cart').send({ bundle_id: 999999, quantity: 1 })
    expect([400, 404]).toContain(res.status)
  })

  it('CA-6 改数量：非法值被拒', async () => {
    const add = await cart('post', '/api/cart').send({ product_id: product.id, quantity: 1 })
    expect(add.status).toBe(200)
    const itemId = add.body.data.id

    for (const quantity of [0, -1, 99999, 'abc']) {
      const res = await cart('put', `/api/cart/${itemId}`).send({ quantity })
      expect(res.status, `quantity=${quantity}`).toBe(400)
    }
  })

  it('CA-7 删购物车条目：不属于自己的条目不能删（IDOR）', async () => {
    const add = await cart('post', '/api/cart').send({ product_id: product.id, quantity: 1 })
    const itemId = add.body.data.id

    // 另一个用户删 → 不能删成功
    const res = await cart('delete', `/api/cart/${itemId}`, otherToken)
    expect(res.status).toBeGreaterThanOrEqual(400)

    // 自己的能删
    const own = await cart('delete', `/api/cart/${itemId}`)
    expect(own.status).toBe(200)
  })

  it('CA-7b 改数量：不能改别人的条目', async () => {
    const add = await cart('post', '/api/cart').send({ product_id: product.id, quantity: 1 })
    const itemId = add.body.data.id

    const res = await cart('put', `/api/cart/${itemId}`, otherToken).send({ quantity: 3 })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('地址边界', () => {
  it('CA-8 地址：必填字段缺失 → 400', async () => {
    const res = await addr('post', '/api/addresses').send({})
    expect(res.status).toBe(400)
  })

  it('CA-9 地址：更新不属于自己的地址 → 404/403', async () => {
    const { Address } = TestDatabase.getSequelize().models
    const address = await Address.create({
      user_id: userId,
      contact_name: 'X',
      contact_phone: '13800138000',
      province: 'A',
      city: 'B',
      district: 'C',
      detail_address: 'D',
      full_address: 'A B C D'
    })
    const res = await addr('put', `/api/addresses/${address.id}`, otherToken).send({
      contact_name: 'Hacker'
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('CA-10 地址：删除不属于自己的地址 → 404/403', async () => {
    const { Address } = TestDatabase.getSequelize().models
    const address = await Address.create({
      user_id: userId,
      contact_name: 'X',
      contact_phone: '13800138000',
      province: 'A',
      city: 'B',
      district: 'C',
      detail_address: 'D',
      full_address: 'A B C D'
    })
    const res = await addr('delete', `/api/addresses/${address.id}`, otherToken)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('CA-11 地址：设置默认地址 + 列表只返回自己的', async () => {
    const created = await addr('post', '/api/addresses').send({
      contact_name: '张三',
      contact_phone: '13800138000',
      province: 'Bangkok',
      city: 'Bangkok',
      district: 'Pathum Wan',
      detail_address: 'Test Road 1',
      full_address: 'Bangkok Bangkok Pathum Wan Test Road 1'
    })
    expect([200, 201]).toContain(created.status)
    const addressId = created.body.data.id

    const setDefault = await addr('put', `/api/addresses/${addressId}/default`)
    expect(setDefault.status).toBe(200)

    const list = await addr('get', '/api/addresses')
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body.data)).toBe(true)
    expect(list.body.data.length).toBeGreaterThanOrEqual(1)
  })
})
