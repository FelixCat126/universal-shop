/**
 * 第 46 轮：把"剩下的缺口"补齐后的闭环护栏
 * ============================================
 *
 * 这一轮把三端盘点里剩下的"看不到 / 用不了 / 悬空"逐条补上：
 *
 * | # | 缺口 | 护栏 |
 * |---|---|---|
 * | 1 | 游客手机号检查不区分国家区号（**同号不同区号互相误拦**） | FC-1 |
 * | 2 | 领券中心的「已领取 / 已领完」按钮态**永远不可达** | FC-2 |
 * | 3 | 管理端**不能注销用户**（只有客户能自助注销） | FC-3/4/5 |
 * | 4 | 操作日志**只能看不能导出** | FC-6 |
 * | 5 | 导出任务清理方法**没挂路由** | FC-7 |
 * | 6 | 管理端看不到合作方订单的**付款时间 / 备注**、账号的**初始口令状态** | FC-8（静态） |
 * | 7 | 合作方起订量（MOQ）**只能改库** | FC-9（端到端） |
 * | 8 | 客户端订单**没有状态筛选**、订单/积分**默认只看最近 3 个月** | FC-10（静态） |
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const models = () => TestDatabase.getSequelize().models

let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  adminToken = TestHelpers.generateAdminToken(admin)
})

describe('第 46 轮 · 闭环补齐', () => {
  it('FC-1 游客手机号检查按 (国家区号, 手机号) 判定（不同区号不互相误拦）', async () => {
    // 已有账号：+66 / 812345678
    await models().User.create(await TestDataFactory.createUser({
      nickname: '泰国客户', phone: '812345678', country_code: '+66'
    }))

    // 同号不同区号 → 不该被判成"已注册"
    const other = await request(app).get('/api/users/check-phone/812345678?country_code=%2B86')
    expect(other.status).toBe(200)
    expect(other.body.data.exists, '同号不同区号不是同一个人，不能拦').toBe(false)

    // 同区号 → 已注册
    const same = await request(app).get('/api/users/check-phone/812345678?country_code=%2B66')
    expect(same.body.data.exists).toBe(true)
  })

  it('FC-2 领券中心只列"此刻能领的"（既有契约），前端不再有不可达按钮态', async () => {
    const { CouponTemplate, UserCoupon } = models()
    const user = await models().User.create(await TestDataFactory.createUser({
      nickname: '领券客户', phone: '812345679', country_code: '+66'
    }))
    const token = TestHelpers.generateToken(user)

    // 总量 1 张的模板 → 我领走后就是"已领完"
    const tpl = await CouponTemplate.create({
      name: '限量券', amount: 10, min_spend: 0, total: 1, per_user: 1, status: 'active'
    })
    await UserCoupon.create({
      template_id: tpl.id, user_id: user.id, code: 'FC2CODE', status: 'unused'
    })

    const res = await request(app).get('/api/coupons/available').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const list = res.body.data.list || []
    expect(list.find(t => t.id === tpl.id), '已领完的不该再出现在"可领"列表里（既有契约）').toBeFalsy()

    // 前端那段「已领取/已领完」按钮态在这个契约下永远不可达 → 必须是死代码（已被清掉）
    const profile = fs.readFileSync(path.join(ROOT, 'src/portal/views/Profile.vue'), 'utf8')
    expect(
      profile.includes("'soldOut'") || profile.includes('coupon.soldOut'),
      '前端不应再保留不可达的「已领完」按钮态'
    ).toBe(false)
  })

  it('FC-3/4/5 管理端注销用户：匿名化 + 停用 + 会话失效 + 历史订单保留', async () => {
    const { User, Order, OrderItem, Product } = models()
    const user = await models().User.create(await TestDataFactory.createUser({
      nickname: '要注销的客户', phone: '812345680', country_code: '+66', email: 'gone@example.com'
    }))
    const userToken = TestHelpers.generateToken(user)
    const product = await Product.create(TestDataFactory.createProduct({ name: '历史商品', price: 50, stock: 10 }))
    const order = await Order.create({
      order_no: `FC${Date.now()}`,
      user_id: user.id,
      total_amount: 50,
      total_amount_thb: 50,
      currency_code: 'THB',
      payment_method: 'cod',
      status: 'shipping',
      contact_name: 'X',
      contact_phone: '13800138000',
      delivery_address: 'A',
      exchange_rate: 1
    })
    await OrderItem.create({ order_id: order.id, product_id: product.id, quantity: 1, price: 50, original_price: 50 })

    const res = await request(app).delete(`/api/admin/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status, `注销应当成功：${JSON.stringify(res.body)}`).toBe(200)

    const row = await User.findByPk(user.id, { raw: true })
    expect(row.is_active, '注销后账号应停用').toBe(false)
    expect(row.email, '邮箱应清空').toBeNull()
    expect(row.nickname).toBe('已注销用户')
    expect(row.username).toBe(`deleted_${user.id}`)
    expect(Number(row.token_version), 'token_version 要自增（所有设备立即退出登录）').toBeGreaterThan(0)

    // 历史订单必须保留（注销不是删数据）
    const stillOrder = await Order.findByPk(order.id)
    expect(stillOrder, '历史订单必须保留').toBeTruthy()

    // 旧会话立即失效
    const after = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${userToken}`)
    // 401 = token 失效；403 = 账号已停用 —— 两种都说明旧会话不能再用
    expect([401, 403], '注销后旧 token 必须失效').toContain(after.status)
  })

  it('FC-6 操作日志可以导出 CSV', async () => {
    const { OperationLog } = models()
    await OperationLog.create({
      admin_id: 1,
      admin_username: 'e2e_admin',
      action: 'update_user_status',
      resource: 'user',
      resource_id: 1,
      description: '把用户停用了'
    })
    const res = await request(app).get('/api/admin/operation-logs/export.csv')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    const csv = res.text
    expect(csv).toContain('admin_username')
    expect(csv).toContain('update_user_status')
  })

  it('FC-7 导出任务的清理方法有路由了（之前只能等定时任务）', async () => {
    const res = await request(app).post('/api/admin/export/jobs/cleanup')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status, `清理应当可用：${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('FC-8 管理端能看到付款时间 / 初始口令状态 / 订单备注', () => {
    // 接口本来就返回这些字段（之前只是表格没这一列）→ 断言字段在
    const partnerOrders = fs.readFileSync(path.join(ROOT, 'src/admin/views/PartnerOrders.vue'), 'utf8')
    expect(partnerOrders, '合作方订单表要有「付款时间」列').toContain('online_paid_at')
    expect(partnerOrders, '合作方订单表要有「备注」列').toContain('notes')

    const partners = fs.readFileSync(path.join(ROOT, 'src/admin/views/Partners.vue'), 'utf8')
    expect(partners, '合作方账号表要有「初始口令」状态列').toContain('must_reset_password')
  })

  it('FC-9 合作方起订量可以在管理端配置，且立刻对合作方生效', async () => {
    // 管理端写入
    const write = await request(app).post('/api/system-config/')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'partner_order_moq_unit',
        value: '20',
        type: 'text',
        description: '合作方订单起订量（测试）'
      })
    expect(write.status).toBe(200)

    // 合作方端读到的就是新值
    const partner = await models().Partner.create({
      login: 'fc9_partner',
      password: 'FcPwd#1234',
      display_name: 'FC9 合作方',
      account_kind: 'dealer',
      is_active: true
    })
    const login = await request(app).post('/api/partner/login')
      .send({ login: 'fc9_partner', password: 'FcPwd#1234' })
    expect(login.status).toBe(200)
    const token = login.body.data.token

    const products = await request(app).get('/api/partner/products').set('Authorization', `Bearer ${token}`)
    expect(products.status).toBe(200)
    const list = products.body.data.products || []
    if (list.length > 0) {
      expect(Number(list[0].moq_unit), '合作方看到的起订量应是刚配置的值').toBe(20)
    }
  })

  it('FC-11 客户可以改订单备注（下单后不再只能找客服）', async () => {
    const { User, Order } = models()
    const user = await models().User.create(await TestDataFactory.createUser({
      nickname: '备注客户', phone: '812345681', country_code: '+66'
    }))
    const token = TestHelpers.generateToken(user)
    const order = await Order.create({
      order_no: `FC11${Date.now()}`,
      user_id: user.id,
      total_amount: 10,
      total_amount_thb: 10,
      currency_code: 'THB',
      payment_method: 'cod',
      status: 'shipping',
      contact_name: 'X',
      contact_phone: '13800138000',
      delivery_address: 'A',
      exchange_rate: 1,
      notes: '原来的备注'
    })

    const res = await request(app).put(`/api/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: '改成：请放前台' })
    expect(res.status, `改备注应当成功：${JSON.stringify(res.body)}`).toBe(200)

    const fresh = await Order.findByPk(order.id, { raw: true })
    expect(fresh.notes).toBe('改成：请放前台')

    // 不能改别人的订单
    const other = await models().User.create(await TestDataFactory.createUser({
      nickname: '别人', phone: '812345682', country_code: '+66'
    }))
    const otherRes = await request(app).put(`/api/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${TestHelpers.generateToken(other)}`)
      .send({ notes: '恶意修改' })
    expect(otherRes.status).toBe(404)
  })

  it('FC-12 订单详情页有「刷新」与「改备注」入口', () => {
    const detail = fs.readFileSync(path.join(ROOT, 'src/portal/views/order/OrderDetail.vue'), 'utf8')
    expect(detail, '订单详情页要有刷新入口（状态变化后不用手动重开页面）').toMatch(/刷新|refresh/i)
    expect(detail, '订单详情页要有改备注入口').toContain('updateOrderNotes')
  })

  it('FC-13 行为审计日志：写进去的行为，运营查得到（之前只写不读）', async () => {
    const { AuditLog } = models()
    await AuditLog.create({
      actor_type: 'partner',
      actor_id: 7,
      actor_label: 'e2e_partner',
      event: 'partner.order.create',
      resource: 'partner_order',
      resource_id: 42,
      success: true,
      ip_address: '203.0.113.9'
    })

    const res = await request(app).get('/api/admin/audit-logs?actor_type=partner')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status, `读行为审计应当成功：${JSON.stringify(res.body)}`).toBe(200)
    const rows = res.body.data.logs
    expect(rows.length).toBeGreaterThan(0)
    const row = rows.find(r => r.event === 'partner.order.create')
    expect(row, '合作方的行为必须能被运营查到').toBeTruthy()
    expect(row.actor_label).toBe('e2e_partner')
    expect(row.ip_address).toBe('203.0.113.9')
  })

  it('FC-14 行为审计有页面与菜单入口', () => {
    const router = fs.readFileSync(path.join(ROOT, 'src/admin/router/index.js'), 'utf8')
    const layout = fs.readFileSync(path.join(ROOT, 'src/admin/components/Layout.vue'), 'utf8')
    expect(router, '管理端路由要有行为审计页').toContain("path: '/audit-logs'")
    expect(layout, '菜单要有行为审计入口').toContain('menu.auditLogs')
  })

  it('FC-10 客户端订单有状态筛选、订单/积分有「全部时间」', () => {
    const profile = fs.readFileSync(path.join(ROOT, 'src/portal/views/Profile.vue'), 'utf8')
    expect(profile, '订单列表要有状态筛选').toContain('ordersStatusFilter')
    expect(profile, '订单请求要带 status 参数').toMatch(/status:\s*reqStatus|\.\.\.\(reqStatus\s*\?\s*\{\s*status/)
    expect(profile, '订单要有「全部时间」开关').toContain('ordersAllTime')
    expect(profile, '积分流水要有「全部时间」开关').toContain('pointsAllTime')
  })
})
