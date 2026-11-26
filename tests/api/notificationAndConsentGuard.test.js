/**
 * 站内通知 + 条款/年龄确认护栏（第 54 轮）
 * =========================================
 *
 * ## 这两条护栏守什么
 *
 * ### 通知（NR-*）
 *
 * 1. **通知必须真的发出去**：运营改了订单状态 → 用户必须知道
 *    （原来用户端零感知，只能反复刷订单页）。
 * 2. **通知失败不能影响业务**：写通知抛错 → 订单状态变更**仍然成功**
 *    （否则运营会以为改失败了又点一次 → 状态被改两次）。
 * 3. **通知必须是私人的**：别人的通知改不动、看不到。
 *
 * ### 条款与年龄确认（CN-*）
 *
 * 4. **缺确认必须被拒**：绕过前端直接 curl 下单 → 必须 400。
 * 5. **游客下单也必须确认**：游客账号是下单那一刻自动创建的，
 *    只在注册页加勾选框 = 游客 100% 绕过。
 * 6. **确认后要留痕**：`terms_accepted_at` / `age_confirmed_at` 落库。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const models = () => TestDatabase.getSequelize().models

describe('站内通知 + 条款/年龄确认护栏', () => {
  let user
  let token
  let admin
  let adminToken
  let product

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    await seedSystemConfigBaseline()
    const { User, Product } = models()
    user = await User.create(await TestDataFactory.createUser())
    token = TestHelpers.generateToken(user)
    admin = await TestHelpers.createAdminUser({ role: 'admin' })
    adminToken = TestHelpers.generateAdminToken(admin)
    product = await Product.create(
      TestDataFactory.createProduct({ stock: 100, price: 100, status: 'active' })
    )
  })

  /** 下一个订单（走真实下单接口，带确认字段） */
  async function createOrder (overrides = {}) {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '通知测试',
        contact_phone: '13800000000',
        delivery_address: 'A',
        terms_accepted: true,
        age_confirmed: true,
        ...overrides
      })
    expect(res.status).toBe(201)
    return res.body.data.order
  }

  // ---------------- 通知 ----------------

  it('NR-1 运营改订单状态 → 用户收到站内信', async () => {
    const order = await createOrder()

    const res = await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipped', tracking_number: 'SF123456' })

    expect(res.status).toBe(200)

    const { Notification } = models()
    // 按类型查：下单时可能还有一条"注册赠券到账"的通知（那也是对的）
    const rows = await Notification.findAll({
      where: { user_id: user.id, type: 'order_status' }
    })
    expect(rows.length, '订单发货后用户没有收到状态变更的站内信').toBe(1)
    expect(rows[0].data.order_no).toBe(order.order_no)
    expect(rows[0].data.tracking_number).toBe('SF123456')
    expect(rows[0].link).toContain(`/portal/orders/${order.id}`)
    expect(rows[0].is_read).toBe(false)
  })

  it('NR-2 通知写失败不能影响业务（订单状态仍然变更成功）', async () => {
    const order = await createOrder()

    const { Notification } = models()
    const spy = vi.spyOn(Notification, 'create').mockRejectedValue(new Error('模拟通知写入失败'))

    try {
      const res = await request(app)
        .put(`/api/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped' })

      // 关键：业务成功
      expect(res.status, '通知失败把业务也搞失败了 —— 运营会以为改失败又点一次').toBe(200)
      const { Order } = models()
      const updated = await Order.findByPk(order.id)
      expect(updated.status).toBe('shipped')
    } finally {
      spy.mockRestore()
    }
  })

  it('NR-3 通知是私人的：改不动也看不到别人的', async () => {
    const order = await createOrder()
    const { Notification } = models()
    const row = await Notification.create({
      user_id: user.id,
      type: 'system',
      data: { message: 'x' },
      is_read: false
    })

    // 另一个用户改这条 → 不生效
    const other = await models().User.create(await TestDataFactory.createUser())
    const otherToken = TestHelpers.generateToken(other)

    const res = await request(app)
      .put(`/api/notifications/${row.id}/read`)
      .set('Authorization', `Bearer ${otherToken}`)
    expect(res.status).toBe(404)

    const still = await Notification.findByPk(row.id)
    expect(still.is_read, '别人的通知被改成了已读').toBe(false)

    // 列表里也看不到
    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${otherToken}`)
    expect(list.body.data.notifications.length).toBe(0)
  })

  it('NR-4 未读数与全部已读', async () => {
    const order = await createOrder()
    await request(app)
      .put(`/api/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipped' })

    const count = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
    // 至少有一条（可能还有注册赠券那条）—— 重点是"有未读"
    expect(count.body.data.unread).toBeGreaterThanOrEqual(1)

    const all = await request(app)
      .put('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`)
    expect(all.status).toBe(200)

    const after = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
    expect(after.body.data.unread).toBe(0)
  })

  // ---------------- 条款与年龄确认 ----------------

  it('CN-1 缺条款/年龄确认 → 400（绕过前端直接调接口也拦得住）', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: 'X',
        contact_phone: '13800000000',
        delivery_address: 'A',
        // 故意不传（显式 undefined → JSON 里就是没有这个字段，
        // 且测试基座的"补默认值"只补**缺失**的字段，不会覆盖显式值）
        terms_accepted: undefined,
        age_confirmed: undefined
      })

    expect(res.status).toBe(400)
    // Joi 层先拦（VALIDATION_ERROR + 字段级 details）；
    // 控制器的 CONSENT_REQUIRED 是绕过 Joi 时的第二道防线。
    expect(['VALIDATION_ERROR', 'CONSENT_REQUIRED']).toContain(res.body.code)
    const fields = (res.body.details || []).map((d) => d.field)
    expect(fields.join(',')).toContain('terms_accepted')
  })

  it('CN-2 传 false 也被拒（不是"有值就行"）', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: 'X',
        contact_phone: '13800000000',
        delivery_address: 'A',
        terms_accepted: false,
        age_confirmed: true
      })
    expect(res.status).toBe(400)
  })

  it('CN-3 游客下单同样必须确认，且确认后留痕', async () => {
    // 不带 token → 游客路径
    const res = await request(app)
      .post('/api/orders')
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '游客',
        contact_phone: '+66812345678',
        delivery_address: 'Bangkok',
        province: 'Bangkok',
        city: 'Bangkok',
        district: 'Pathum Wan',
        detail_address: '123 Test Road',
        postal_code: '10400',
        terms_accepted: true,
        age_confirmed: true
      })
    expect(res.status, '游客下单没有被要求确认条款/年龄').toBe(201)

    const { User } = models()
    const guest = await User.findOne({ where: { phone: '812345678' } })
    expect(guest, '游客账号没有建出来').toBeTruthy()
    expect(guest.terms_accepted_at, '游客的条款确认没有留痕').toBeTruthy()
    expect(guest.age_confirmed_at, '游客的年龄确认没有留痕').toBeTruthy()
  })

  it('CN-4 注册时确认 → 留痕', async () => {
    const res = await request(app)
      .post('/api/users/register')
      .send({
        nickname: '确认测试',
        phone: '8899001122',
        country_code: '+66',
        password: 'Consent#2026',
        terms_accepted: true,
        age_confirmed: true
      })
    expect(res.status).toBe(201)

    const { User } = models()
    const created = await User.findOne({ where: { phone: '8899001122' } })
    expect(created.terms_accepted_at).toBeTruthy()
    expect(created.age_confirmed_at).toBeTruthy()
  })

  it('CN-5 注册缺确认 → 400（注册页的勾选框同样能被绕过）', async () => {
    const res = await request(app)
      .post('/api/users/register')
      .send({
        nickname: '没确认',
        phone: '8899002233',
        country_code: '+66',
        password: 'Consent#2026',
        terms_accepted: undefined,
        age_confirmed: undefined
      })
    expect(res.status).toBe(400)
  })
})
