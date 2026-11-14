/**
 * 「下架不复活已删商品」的护栏
 *
 * ## 约定（业务决定）
 *
 * 已删除（软删）的商品**不参与**上下架：
 *   - 批量「上架」**不能**把它变回在售（那会让"删除"这个动作形同虚设）；
 *   - 只有**显式**的 `POST /api/admin/products/:id/restore` 能让它回来。
 *
 * ## 为什么要有这条护栏
 *
 * Product 是软删模型，而 `Model.update()` 默认带 `deleted_at IS NULL`。
 * 哪天有人为了"修批量上架不生效"而顺手加了 `paranoid: false`，
 * 已删商品就会被批量上架回来 —— **删除变成可撤销**，
 * 而且没有人在当时会立刻发现（管理端列表里它又出现了）。
 *
 * 这条护栏把那个"顺手"钉死。
 *
 *   DP-1 批量上架不复活已删商品
 *   DP-2 批量下架不影响已删商品
 *   DP-3 改已删商品的字段不会让它复活
 *   DP-4 只有 restore 能让它回来（且回来后确实在售）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let token
let aliveProduct
let deletedProduct

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)

  aliveProduct = await models().Product.create({
    name: '在售商品', price: 100, stock: 10, status: 'active'
  })
  // 初始状态给 inactive：这样"批量上架"若误改到它，状态会明显变成 active 而被抓到
  deletedProduct = await models().Product.create({
    name: '已删商品', price: 100, stock: 10, status: 'inactive'
  })
  // 软删（管理端删除走的就是这条路）
  await deletedProduct.destroy()
})

/** 该商品是否仍处于"已删除"状态 */
async function isDeleted (id) {
  const row = await models().Product.findByPk(id, { paranoid: false, raw: true })
  return !!row?.deleted_at
}

describe('已删商品不被上下架复活', () => {
  it('DP-1 批量上架不复活已删商品', async () => {
    const res = await request(app).post('/api/products/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [aliveProduct.id, deletedProduct.id], action: 'activate' })
    expect(res.status).toBe(200)

    // 在售的那个被上架了
    const alive = await models().Product.findByPk(aliveProduct.id, { paranoid: false, raw: true })
    expect(alive.status).toBe('active')

    // 已删的那个**仍然处于已删状态**（没有被复活）
    expect(await isDeleted(deletedProduct.id), '批量上架把已删商品复活了').toBe(true)
    const still = await models().Product.findByPk(deletedProduct.id, { paranoid: false, raw: true })
    expect(still.status, '已删商品的 status 不该被批量上架改动').toBe('inactive')

    // 公开列表里不应出现
    const pub = await request(app).get('/api/products')
    const ids = (pub.body?.data?.products || pub.body?.data || []).map(p => p.id)
    expect(ids, '已删商品出现在了公开列表里').not.toContain(deletedProduct.id)
  })

  it('DP-2 批量下架不影响已删商品', async () => {
    const res = await request(app).post('/api/products/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [aliveProduct.id, deletedProduct.id], action: 'deactivate' })
    expect(res.status).toBe(200)

    expect(await isDeleted(deletedProduct.id)).toBe(true)
    const still = await models().Product.findByPk(deletedProduct.id, { paranoid: false, raw: true })
    expect(still.status, '已删商品的状态不该被批量下架改写').toBe('inactive')
  })

  it('DP-3 改已删商品的字段不会让它复活', async () => {
    const res = await request(app).put(`/api/products/${deletedProduct.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '改过名字', status: 'active' })
    // 管理端可以看到已删商品（paranoid:false），所以这里不要求 404；
    // 关键的是：改完之后它**仍然是已删状态**。
    expect([200, 404]).toContain(res.status)
    expect(await isDeleted(deletedProduct.id), '改字段把已删商品复活了').toBe(true)
  })

  it('DP-4 只有 restore 能让它回来（且回来后确实在售）', async () => {
    const res = await request(app).post(`/api/products/${deletedProduct.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    expect(await isDeleted(deletedProduct.id), 'restore 后仍是已删状态').toBe(false)
    const back = await models().Product.findByPk(deletedProduct.id, { raw: true })
    expect(back, 'restore 后应能按正常查询查到').toBeTruthy()

    const pub = await request(app).get('/api/products')
    const ids = (pub.body?.data?.products || pub.body?.data || []).map(p => p.id)
    expect(ids, 'restore 后应重新出现在公开列表里').toContain(deletedProduct.id)
  })
})
