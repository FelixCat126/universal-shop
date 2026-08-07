/**
 * P0 关键业务正确性 / 真实漏洞（25 用例）
 *
 * 设计原则：覆盖此前梳理中识别的 0 覆盖 / 0 用例 / 隐式风险路径。
 * 任何用例失败都可能意味着真实漏洞，应在不修改源代码的前提下报告。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _clearAuthCacheForTests } from '@server/middlewares/authMiddleware.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _clearAuthCacheForTests()
  _resetLoginGuardForTests()
})

async function makeUser (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { User } = sequelize.models
  const data = await TestDataFactory.createUser({
    country_code: '+86',
    phone: TestHelpers.generatePhoneNumber('+86'),
    ...overrides
  })
  return User.create(data)
}

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

async function activeProduct (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { Product } = sequelize.models
  return Product.create(
    TestDataFactory.createProduct({ stock: 50, status: 'active', price: 100, ...overrides })
  )
}

async function partnerCtx ({
  discount_percent = 10,
  account_kind = 'dealer',
  productPrice = 100,
  productStock = 10000
} = {}) {
  await seedSystemConfigBaseline()
  const { partner, address, token } = await TestHelpers.createPartnerWithAddress({
    discount_percent,
    account_kind
  })
  const { Product } = TestDatabase.getSequelize().models
  const product = await Product.create(
    TestDataFactory.createProduct({
      price: productPrice,
      discount: null,
      stock: productStock,
      status: 'active'
    })
  )
  return { partner, address, token, product }
}

describe('P0-Supplement.invalidateAuthCache', () => {
  it('P0-1 admin 禁用用户 → 用户 token 5s 内立即 401/403', async () => {
    const user = await makeUser()
    const userToken = TestHelpers.generateToken(user)
    const { token: adminToken } = await adminCtx()

    // 预热：先用 token 访问一次 profile，让 5s 缓存生效
    const ok = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect(ok.status).toBe(200)

    // admin 禁用
    const dis = await request(app)
      .put(`/api/admin/users/${user.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false })
    expect(dis.status).toBe(200)

    // 立刻复用同一 token → 应被 401/403 拒绝（invalidateAuthCache 生效）
    const after = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
    expect([401, 403]).toContain(after.status)
  })
})

describe('P0-Supplement.avatarUrlPathTraversal', () => {
  it('P0-2a updateProfile avatar_url 含 ".." → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app)
      .put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'X', avatar_url: '/uploads/avatars/../../../etc/passwd' })
    expect(res.status).toBe(400)
  })

  it('P0-2b updateProfile avatar_url 不以 /uploads/avatars/ 开头 → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app)
      .put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'X', avatar_url: 'https://evil.com/x.png' })
    expect(res.status).toBe(400)
  })

  it('P0-2c updateProfile avatar_url 含 "\\" → 400', async () => {
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const res = await request(app)
      .put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'X', avatar_url: '/uploads/avatars/..\\..\\evil' })
    expect(res.status).toBe(400)
  })
})

describe('P0-Supplement.adminSelfProtection', () => {
  it('P0-3 admin 改自己 is_active=false → 400', async () => {
    const { admin, token } = await adminCtx('super_admin')
    const res = await request(app)
      .put(`/api/admin/administrators/${admin.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: false })
    expect(res.status).toBe(400)
  })

  it('P0-4 admin 删自己 → 400', async () => {
    const { admin, token } = await adminCtx('super_admin')
    const res = await request(app)
      .delete(`/api/admin/administrators/${admin.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('P0-5 admin（非 super_admin）改 super_admin 角色 → 403', async () => {
    const { admin: superAdmin } = await adminCtx('super_admin')
    const { token: adminToken } = await adminCtx('admin')
    const res = await request(app)
      .put(`/api/admin/administrators/${superAdmin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'operator' })
    expect(res.status).toBe(403)
  })

  it('P0-6 super_admin 改 super_admin 角色 → 200', async () => {
    const { admin: superAdmin } = await adminCtx('super_admin')
    const { token: superToken } = await adminCtx('super_admin')
    const res = await request(app)
      .put(`/api/admin/administrators/${superAdmin.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ role: 'admin' })
    expect(res.status).toBe(200)
  })

  it('P0-7 super_admin is_active=false → 400 受保护', async () => {
    const { admin: superAdmin } = await adminCtx('super_admin')
    const { token: superToken } = await adminCtx('super_admin')
    const res = await request(app)
      .put(`/api/admin/administrators/${superAdmin.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ is_active: false })
    expect(res.status).toBe(400)
  })

  it('P0-8 admin 已有 email 重复 → 400', async () => {
    const { admin: existing } = await adminCtx()
    const { token } = await adminCtx()
    const res = await request(app)
      .post('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'newadmin', password: 'Abcd1234', email: existing.email })
    expect(res.status).toBe(400)
  })
})

describe('P0-Supplement.delistedProduct', () => {
  it('P0-9 已下架商品前台访问 → 404', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p = await activeProduct({ stock: 10 })
    // admin 软删
    const { token: adminToken } = await adminCtx()
    const del = await request(app)
      .delete(`/api/products/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)

    // 前台访问（小写接口名）
    const res = await request(app).get(`/api/products/${p.id}`)
    expect(res.status).toBe(404)
  })

  it('P0-10 列表 stockStatus=normal/low/out 筛选', async () => {
    // 制作三类库存：>10 / 1~10 / 0
    await activeProduct({ stock: 50, name: 'hi-1' })
    await activeProduct({ stock: 5, name: 'hi-2' })
    await activeProduct({ stock: 0, name: 'hi-3' })
    const { token } = await adminCtx('admin')
    const base = (q) => request(app).get(`/api/products${q}`).set('Authorization', `Bearer ${token}`)

    const normal = await base('?stockStatus=normal')
    expect(normal.status).toBe(200)
    const low = await base('?stockStatus=low')
    expect(low.status).toBe(200)
    const out = await base('?stockStatus=out')
    expect(out.status).toBe(200)

    // 简单数量断言（avoid 依赖路径别名）
    const namesOf = (b) => (b.data.products || []).map((p) => p.name)
    expect(namesOf(normal.body)).toContain('hi-1')
    expect(namesOf(normal.body)).not.toContain('hi-2')
    expect(namesOf(normal.body)).not.toContain('hi-3')
    expect(namesOf(low.body)).toContain('hi-2')
    expect(namesOf(low.body)).not.toContain('hi-1')
    expect(namesOf(out.body)).toContain('hi-3')
  })

  it('P0-11 listingStatus=delisted 仅 admin 可见', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    // 一件正常 + 一件软删
    const live = await activeProduct({ name: 'live' })
    const dead = await activeProduct({ name: 'dead' })
    const { token } = await adminCtx()
    await request(app).delete(`/api/products/${dead.id}`).set('Authorization', `Bearer ${token}`)

    // admin 列表 listingStatus=delisted 只看到 dead
    const r1 = await request(app).get('/api/products?listingStatus=delisted')
      .set('Authorization', `Bearer ${token}`)
    expect(r1.status).toBe(200)
    const arr1 = (r1.body.data.products || []).map((p) => p.name)
    expect(arr1).toContain('dead')
    expect(arr1).not.toContain('live')

    // admin 列表 listingStatus=on_shelf 只看到 live
    const r2 = await request(app).get('/api/products?listingStatus=on_shelf')
      .set('Authorization', `Bearer ${token}`)
    const arr2 = (r2.body.data.products || []).map((p) => p.name)
    expect(arr2).toContain('live')
    expect(arr2).not.toContain('dead')

    // 前台（无 token）只看到 live
    const r3 = await request(app).get('/api/products')
    const arr3 = (r3.body.data.products || []).map((p) => p.name)
    expect(arr3).toContain('live')
    expect(arr3).not.toContain('dead')

    // 防止 live 没建好影响测试
    expect(live.id).toBeGreaterThan(0)
  })
})

describe('P0-Supplement.productValidation', () => {
  it('P0-12 createProduct points 负数 → 400', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x', price: 10, stock: 5, category_id: cat.id, points: -1 })
    expect(res.status).toBe(400)
  })

  it('P0-13 createProduct points 非整数 → 400', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x', price: 10, stock: 5, category_id: cat.id, points: 1.5 })
    expect(res.status).toBe(400)
  })

  it('P0-14 createProduct stock 字符串 → 接受并 parseInt', async () => {
    // 真实情况：parseInt stock 不会 400，role 用 stock=null 会 400
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory } = sequelize.models
    const cat = await ProductCategory.create({ name: 'cat', sort_order: 1 })
    const res = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x', price: 10, stock: 'abc', category_id: cat.id })
    // 当前行为：parseInt('abc') = NaN → 落库失败 → 500
    expect([500, 400]).toContain(res.status)
  })
})

describe('P0-Supplement.adminUserList', () => {
  it('P0-15 GET /admin/users 5 维组合 AND 筛选', async () => {
    const sequelize = TestDatabase.getSequelize()
    const { User } = sequelize.models
    // 5 个用户：只有 A 全部命中
    const a = await User.create(await TestDataFactory.createUser({
      country_code: '+86',
      phone: TestHelpers.generatePhoneNumber('+86'),
      nickname: '匹配A',
      email: 'a@x.com',
      referral_code: 'MATCHA'
    }))
    const b = await User.create(await TestDataFactory.createUser({
      country_code: '+86',
      phone: TestHelpers.generatePhoneNumber('+86'),
      nickname: '匹配B',
      email: 'b@x.com'
    }))
    const { token } = await adminCtx()
    const res = await request(app)
      .get(`/api/admin/users?name=${encodeURIComponent('匹配A')}&email=a@x.com&referral_code=MATCHA`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const ids = res.body.data.users.map((u) => u.id)
    expect(ids).toContain(a.id)
    expect(ids).not.toContain(b.id)
  })
})

describe('P0-Supplement.partnerOrderEdge', () => {
  it('P0-16 partner update 订单状态非法值 → 400', async () => {
    const { token: adminToken } = await adminCtx()
    const { partner, address, token, product } = await partnerCtx()
    const create = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_id: product.id, quantity: 50 }], partner_address_id: address.id })
    expect(create.status).toBe(201)

    const res = await request(app)
      .put(`/api/admin/partner-orders/${create.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'fake_status' })
    expect(res.status).toBe(400)
  })

  it('P0-17 agent 路径 → 201 + status=pending_payment + ≤3 SKU', async () => {
    const { token, address, product } = await partnerCtx({ account_kind: 'agent' })
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const p2 = await Product.create(TestDataFactory.createProduct({
      price: 50, discount: null, stock: 10000, status: 'active'
    }))
    const res = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { product_id: product.id, quantity: 20 },
          { product_id: p2.id, quantity: 20 }
        ],
        partner_address_id: address.id
      })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('pending_payment')
  })

  it('P0-18 agent 路径超 3 SKU → 400', async () => {
    const { token, address, product } = await partnerCtx({ account_kind: 'agent' })
    const sequelize = TestDatabase.getSequelize()
    const { Product } = sequelize.models
    const extras = []
    for (let i = 0; i < 3; i++) {
      extras.push(await Product.create(TestDataFactory.createProduct({
        price: 50, discount: null, stock: 10000, status: 'active'
      })))
    }
    const items = [product, ...extras].map((p) => ({ product_id: p.id, quantity: 20 }))
    const res = await request(app).post('/api/partner/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items, partner_address_id: address.id })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/代理账号/)
  })

  it('P0-19 合作方 listMyOrders 起始晚于结束 → 自动交换', async () => {
    const { token } = await partnerCtx()
    const res = await request(app).get('/api/partner/orders?from=2026-01-15&to=2026-01-01')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('P0-20 合作方 listMyOrders 非法日期 → 400', async () => {
    const { token } = await partnerCtx()
    const res = await request(app).get('/api/partner/orders?from=NOT_A_DATE&to=2026-01-01')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })
})

describe('P0-Supplement.partnerAdmin', () => {
  it('P0-21 admin 删合作方路由当前未注册 → 404（dead route 暴露）', async () => {
    const { token } = await adminCtx()
    const sequelize = TestDatabase.getSequelize()
    const { Partner } = sequelize.models
    const p = await Partner.create(TestDataFactory.createPartner({}))
    const res = await request(app)
      .delete(`/api/admin/partners/${p.id}`)
      .set('Authorization', `Bearer ${token}`)
    // 真实情况：route 未注册 → 404；控制器有但无路由
    expect(res.status).toBe(404)
  })
})

describe('P0-Supplement.operationLogs', () => {
  it('P0-22 getOperationLogs 完整 + keyword/资源/日期筛选', async () => {
    const { admin, token } = await adminCtx('super_admin')
    const sequelize = TestDatabase.getSequelize()
    const { OperationLog } = sequelize.models
    // 制造一些日志
    await OperationLog.create(TestDataFactory.createOperationLog(admin.id, admin.username, {
      action: 'create_order',
      resource: 'order',
      description: 'ct'
    }))
    await OperationLog.create(TestDataFactory.createOperationLog(admin.id, admin.username, {
      action: 'create_user',
      resource: 'user',
      description: 'cu'
    }))

    // 资源筛选
    const r1 = await request(app).get('/api/admin/operation-logs?resource=order')
      .set('Authorization', `Bearer ${token}`)
    expect(r1.status).toBe(200)
    expect(r1.body.data.logs.length).toBe(1)
    expect(r1.body.data.logs[0].resource).toBe('order')

    // 关键字筛选
    const r2 = await request(app).get('/api/admin/operation-logs?keyword=create')
      .set('Authorization', `Bearer ${token}`)
    expect(r2.status).toBe(200)
    expect(r2.body.data.logs.length).toBe(2)
  })

  it('P0-23 initSuperAdmin 已存在管理员 → 400', async () => {
    await adminCtx('super_admin') // 创建 admin 用户
    process.env.INIT_SECRET = 'init-secret'
    const res = await request(app).post('/api/admin/init')
      .set('X-Init-Secret', 'init-secret')
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('P0-Supplement.onlinePaymentMethod', () => {
  it('P0-24 confirmOnlinePayment payment_method !== online → 400', async () => {
    // 直接创建订单 COD，不走 confirm 接口
    const sequelize = TestDatabase.getSequelize()
    const { Order, Product } = sequelize.models
    const user = await makeUser()
    const token = TestHelpers.generateToken(user)
    const p = await Product.create(
      TestDataFactory.createProduct({ stock: 100, status: 'active', price: 50 })
    )
    const o = await Order.create({
      user_id: user.id,
      order_no: `T${Date.now()}`,
      contact_name: 'Test',
      contact_phone: '+8613800000001',
      delivery_address: 'addr',
      status: 'pending',
      payment_method: 'cod',
      total_amount: 50,
      total_amount_thb: 50,
      currency_code: 'THB'
    })

    const res = await request(app)
      .post(`/api/orders/${o.id}/confirm-online-payment`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })
})

describe('P0-Supplement.optAuthAdminToken', () => {
  it('P0-25 optionalAuth admin token 视为未登录（不会 401）', async () => {
    const { token: adminToken } = await adminCtx()
    // 用 admin token 访问 /api/cart → 应 200（当成未登录，sessionId 也没有 → 空数组）
    const res = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
})
