import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { sequelize } from '@server/models/index.js'

const models = () => TestDatabase.getSequelize().models

let adminToken
let userToken

async function seed (orderCount, productCount) {
  const cat = await models().ProductCategory.create({ name: '探针分类', sort_order: 0 })
  for (let i = 0; i < productCount; i++) {
    await models().Product.create({
      name: '探针商品' + i, price: 100, stock: 50, status: 'active', category_id: cat.id
    })
  }
  const user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900001234'
  }))
  userToken = TestHelpers.generateToken(user)
  for (let i = 0; i < orderCount; i++) {
    await models().Order.create({
      order_no: 'PRB' + Date.now() + '_' + i, user_id: user.id,
      total_amount: 100, total_amount_thb: 100, currency_code: 'THB',
      payment_method: 'cod', status: 'completed',
      contact_name: 'x', contact_phone: '13800138000', delivery_address: 'A', exchange_rate: 1
    })
  }
}

async function countQueries (fn) {
  const orig = sequelize.query.bind(sequelize)
  let n = 0
  const shapes = new Set()
  sequelize.query = (...a) => {
    n++
    shapes.add(String(a[0]).replace(/\s+/g, ' ').slice(0, 70))
    return orig(...a)
  }
  try {
    const res = await fn()
    return { n, shapes: shapes.size, res }
  } finally {
    sequelize.query = orig
  }
}

describe('probe N+1', () => {
  it('行数变多时查询数会不会跟着涨', async () => {
    const results = []
    for (const [orders, products] of [[5, 5], [50, 50]]) {
      await TestDatabase.clearAllData()
      const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
      adminToken = TestHelpers.generateAdminToken(admin)
      await seed(orders, products)

      const cases = [
        ['公开商品列表', () => request(app).get('/api/products')],
        ['管理端订单列表', () => request(app).get('/api/admin/orders').set('Authorization', `Bearer ${adminToken}`)],
        ['管理端仪表盘', () => request(app).get('/api/admin/statistics/overview').set('Authorization', `Bearer ${adminToken}`)],
        ['用户订单列表', () => request(app).get('/api/orders').set('Authorization', `Bearer ${userToken}`)],
        ['个人中心指标', () => request(app).get('/api/users/profile/metrics').set('Authorization', `Bearer ${userToken}`)]
      ]
      for (const [label, fn] of cases) {
        const { n, shapes, res } = await countQueries(fn)
        results.push(`  ${orders}单/${products}商品 ${label}: ${n} 条查询 / ${shapes} 种 (status=${res.status})`)
      }
    }
    console.log(results.join('\n'))
    expect(true).toBe(true)
  }, 180000)
})
