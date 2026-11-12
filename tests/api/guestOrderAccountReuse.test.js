/**
 * 游客下单复用账号：不得把会话交给"只知道手机号"的人
 *
 * 真实的接管路径：
 *   1. 受害者 A 用手机号 X 下过游客单 → 系统自动创建账号
 *      （must_reset_password=true，初始密码 = 手机号后 8 位）
 *   2. 攻击者只知道手机号 X → POST /api/orders 用同一个手机号下单
 *   3. 服务端发现该手机号已有"用户自己没设过密码"的账号 → **复用**
 *      （这是为了修复"首单失败后手机号被烧掉、重试永远失败"）
 *   4. 之前这里会**签发该账号的 JWT 并返回** → 攻击者拿到完整会话：
 *      订单/地址/积分全可见，还能代其下单、确认在线支付、改邮箱
 *
 * 现在：只有**新建**账号才签发 token；复用时只回手机号（请求方自己填的）。
 *
 *   GR-1 游客首单（新建账号）→ 有 token（正常流程不受影响）
 *   GR-2 同手机号再次下单（复用）→ **没有 token**
 *   GR-3 复用时也不泄漏账号的邮箱等其它信息
 *   GR-4 正常注册账号（用户自己设过密码）→ 拒绝复用（400），不泄露账号存在
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import { _resetLoginGuardForTests } from '@server/middlewares/loginGuard.js'

const models = () => TestDatabase.getSequelize().models

let product
let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  _resetLoginGuardForTests()
  const { Product } = models()
  product = await Product.create({
    name: '游客下单商品', price: 100, stock: 100, status: 'active'
  })
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)
})

/** 游客下单（未登录） */
function guestOrder (phone, opts = {}) {
  return request(app).post('/api/orders').send({
    contact_name: '游客',
    contact_phone: phone,
    items: [{ product_id: product.id, quantity: 1 }],
    payment_method: 'cod',
    delivery_address: 'Bangkok',
    detail_address: '街道 1 号',
    ...opts
  })
}

describe('游客下单与账号复用', () => {
  it('GR-1 游客首单（新建账号）→ 有 token', async () => {
    await seedSystemConfigBaseline()
    const res = await guestOrder('+8613911223344')
    expect(res.status).toBe(201)
    expect(res.body.data.token, '新建账号应给 token（要靠它查订单）').toBeTruthy()
    expect(res.body.data.autoRegistered).toBe(true)
  })

  it('GR-2 同手机号再次下单（复用账号）→ 没有 token', async () => {
    await seedSystemConfigBaseline()
    const first = await guestOrder('+8613911223345')
    expect(first.status).toBe(201)
    expect(first.body.data.token).toBeTruthy()

    // 第二次：账号已存在且是系统随机密码的账号 → 复用
    const second = await guestOrder('+8613911223345')
    expect(second.status).toBe(201)
    expect(second.body.data.token, '⚠️ 复用时绝不能发 token（= 交出会话）').toBeFalsy()
    expect(second.body.data.autoRegistered).toBeFalsy()
    expect(second.body.data.accountReused).toBe(true)
  })

  it('GR-3 复用时也不泄漏账号的其它信息（邮箱等）', async () => {
    await seedSystemConfigBaseline()
    await guestOrder('+8613911223346')

    // 给这个自动注册的账号补一个邮箱（模拟用户后来填过资料）
    const { User } = models()
    const u = await User.findOne({ where: { phone: '13911223346' } })
    expect(u).toBeTruthy()
    u.email = 'victim@example.com'
    await u.save()

    const second = await guestOrder('+8613911223346')
    expect(second.status).toBe(201)
    expect(second.body.data.user.email, '复用时不该回传邮箱').toBeUndefined()
    expect(second.body.data.user.phone).toBe('13911223346')
  })

  it('GR-4 正常注册账号（用户自己设过密码）→ 拒绝复用', async () => {
    const { User } = models()
    await User.create({
      username: 'realuser001',
      nickname: '正常用户',
      phone: '13911223347',
      country_code: '+86',
      password: 'Abcd1234',
      must_reset_password: false,
      is_active: true
    })

    await seedSystemConfigBaseline()
    const res = await guestOrder('+8613911223347')
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/已被注册|无法自动注册/)
    expect(res.body.data).toBeUndefined()
  })
})
