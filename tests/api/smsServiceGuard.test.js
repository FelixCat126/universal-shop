/**
 * 短信服务护栏（第 55 轮）
 * ========================
 *
 * ## 短信是唯一"走不通就完全失联"的通道
 *
 * 站内信用户刷新就能看到；短信发没发、发没发到，用户只会说"没收到"。
 * 所以短信这一层要格外小心。
 *
 * ## 用例
 *
 *   SM-1 未配置通道时业务短信**静默跳过**，不影响业务
 *   SM-2 通道报错时业务短信**不抛错**（业务照常成功）
 *   SM-3 防轰炸：同号码 + 同模板在冷却期内只发一次
 *   SM-4 每次发送都**留痕**（含 skipped/failed 的原因）
 *   SM-5 多语言：按区号选文案（+66 泰语 / +86 中文 / 其它英文）
 *   SM-6 业务短信开关：关闭时一律不发
 *   SM-7 事件白名单：只发白名单里的事件
 *   SM-8 密码重置**不受业务开关影响**（OTP 是流程的一部分）
 *   SM-9 手机号拆分：带区号 / 不带区号都能处理
 *   SM-10 已发货短信：订单状态变更后真的发出去了
 *   SM-11 同一号码的两单在冷却期内先后发货 → **两单都发**
 *   SM-12 密码重置连着请求两次 → **两条都发**（否则用户被锁死）
 *   SM-13 没有物流单号时短信里**不出现占位符**
 *   SM-14 状态映射不反：已发货发"已发货"，已送达发"已送达"
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'
import {
  sendSms,
  SMS_EVENTS,
  SMS_TEMPLATES,
  getBusinessSmsPolicy,
  splitPhone,
  renderTemplate
} from '@server/services/smsService.js'
import SmsLog from '@server/models/SmsLog.js'

const models = () => TestDatabase.getSequelize().models

/**
 * 每个用例用**不同的手机号**。
 *
 * 原因：防轰炸的冷却表是**模块级**状态（`lastSentAt` Map），
 * 跨用例不会自动清空 —— 同一个号码在第二个用例里会被冷却挡掉，
 * 症状是"短信没发出去"，与被测逻辑无关。
 * （这本身也说明：防轰炸是**按号码+模板**生效的，不同号码互不影响。）
 */

describe('短信服务护栏', () => {
  let fetchSpy
  let sent

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    await seedSystemConfigBaseline()
    sent = []
    // 拦截 webhook：记录每次请求，模拟成功
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200 }
    })
    process.env.SMS_WEBHOOK_URL = 'https://sms.example.test/send'
    process.env.SMS_WEBHOOK_TOKEN = 'test-token'
    process.env.SMS_BUSINESS_ENABLED = '1'
    process.env.SMS_COOLDOWN_SECONDS = '300'
  })

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore()
    delete process.env.SMS_WEBHOOK_URL
    delete process.env.SMS_WEBHOOK_TOKEN
    delete process.env.SMS_BUSINESS_ENABLED
    delete process.env.SMS_BUSINESS_EVENTS
    delete process.env.SMS_COOLDOWN_SECONDS
  })

  it('SM-1 未配置通道时业务短信静默跳过，不抛错', async () => {
    delete process.env.SMS_WEBHOOK_URL
    const res = await sendSms({
      phone: '+66812345678',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD1', contact_name: 'A', tracking_number: 'SF1' }
    })
    expect(res.sent).toBe(false)
    expect(res.reason).toBe('channel_not_configured')
    // 关键：不抛错
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('SM-2 通道报错时业务短信不抛错（业务照常成功）', async () => {
    fetchSpy.mockImplementation(async () => ({ ok: false, status: 500 }))
    const res = await sendSms({
      phone: '+66812345002',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD1', contact_name: 'A', tracking_number: 'SF1' }
    })
    expect(res.sent).toBe(false)
    expect(res.reason).toBe('send_failed')
  })

  it('SM-3 防轰炸：同号码 + 同模板在冷却期内只发一次', async () => {
    const opts = {
      phone: '+66812345003',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD1', contact_name: 'A', tracking_number: 'SF1' }
    }
    const first = await sendSms(opts)
    expect(first.sent).toBe(true)
    expect(sent.length).toBe(1)

    const second = await sendSms(opts)
    expect(second.sent).toBe(false)
    expect(second.reason).toBe('cooldown')
    expect(sent.length, '冷却期内又发了一条 —— 用户会被刷屏，还烧短信费').toBe(1)

    // 不同模板不受同一冷却影响
    const other = await sendSms({ ...opts, template: SMS_EVENTS.ORDER_DELIVERED })
    expect(other.sent).toBe(true)
    expect(sent.length).toBe(2)
  })

  it('SM-4 每次发送都留痕（含 skipped/failed 的原因）', async () => {
    await sendSms({
      phone: '+66812345004',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD1', contact_name: 'A', tracking_number: 'SF1' }
    })
    const rows = await SmsLog.findAll()
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].template).toBe(SMS_EVENTS.ORDER_SHIPPED)
    expect(rows[0].phone).toBe('812345004')
    expect(rows[0].country_code).toBe('+66')
    expect(rows[0].message).toContain('ORD1')

    // 冷却命中也要留痕（"为什么这一条没发"是排查的关键）
    const again = await sendSms({
      phone: '+66812345004',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD1', contact_name: 'A', tracking_number: 'SF1' }
    })
    expect(again.reason).toBe('cooldown')
    const cooldownRow = await SmsLog.findOne({ where: { phone: '812345004', status: 'skipped' } })
    expect(cooldownRow).toBeTruthy()
    expect(cooldownRow.reason).toBe('cooldown')

    // 通道没配 → 不留痕（部署级状态，管理端有提示；逐条写行会随订单数线性膨胀）
    delete process.env.SMS_WEBHOOK_URL
    await sendSms({
      phone: '+66812345079',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD2' }
    })
    const skipped = await SmsLog.findOne({ where: { phone: '812345079' } })
    expect(skipped, '通道没配不是消息级事件，不该逐条写留痕').toBeNull()
  })

  it('SM-5 按区号选语言', async () => {
    const vars = { order_no: 'ORD1', contact_name: 'A', tracking_number: 'SF1' }
    await sendSms({ phone: '+66812345005', template: SMS_EVENTS.ORDER_SHIPPED, vars })
    expect(sent[0].body.locale).toBe('th-TH')
    expect(sent[0].body.message).toBe(
      renderTemplate(SMS_TEMPLATES[SMS_EVENTS.ORDER_SHIPPED]['th-TH'], vars)
    )

    await sendSms({ phone: '+8613812345001', template: SMS_EVENTS.ORDER_SHIPPED, vars })
    expect(sent[1].body.locale).toBe('zh-CN')

    await sendSms({ phone: '+60123450002', template: SMS_EVENTS.ORDER_SHIPPED, vars })
    expect(sent[2].body.locale).toBe('en-US')
  })

  it('SM-6 业务短信开关关闭时一律不发', async () => {
    process.env.SMS_BUSINESS_ENABLED = '0'
    const { enabled } = await getBusinessSmsPolicy()
    expect(enabled).toBe(false)
  })

  it('SM-7 事件白名单：只发白名单里的', async () => {
    process.env.SMS_BUSINESS_EVENTS = 'order_shipped'
    const { events } = await getBusinessSmsPolicy()
    expect(events).toEqual(['order_shipped'])
    // 不在白名单里的事件不会被列出来
    expect(events).not.toContain(SMS_EVENTS.AFTER_SALE_REVIEWED)
  })

  it('SM-7b 白名单留空时用默认事件集（开了开关就该有效果）', async () => {
    delete process.env.SMS_BUSINESS_EVENTS
    const { enabled, events } = await getBusinessSmsPolicy()
    expect(enabled).toBe(true)
    expect(events).toEqual([SMS_EVENTS.ORDER_SHIPPED, SMS_EVENTS.AFTER_SALE_REVIEWED])
  })

  it('SM-7c 总开关关着时，白名单留空也不发任何事件', async () => {
    process.env.SMS_BUSINESS_ENABLED = '0'
    delete process.env.SMS_BUSINESS_EVENTS
    const { enabled, events } = await getBusinessSmsPolicy()
    expect(enabled).toBe(false)
    expect(events).toEqual([])
  })

  it('SM-8 密码重置不受业务短信开关影响', async () => {
    // 业务短信关着，但密码重置的 OTP 仍然要能发
    process.env.SMS_BUSINESS_ENABLED = '0'
    const res = await sendSms({
      phone: '+66812345008',
      template: SMS_EVENTS.PASSWORD_RESET,
      vars: { otp: '123456', minutes: 10 },
      require: true
    })
    expect(res.sent).toBe(true)
    expect(sent.length).toBe(1)
  })

  it('SM-9 手机号拆分：带区号/不带区号都能处理', () => {
    // '+66 812345678' 去掉区号后是 8 位本地号（泰国国际格式不带前导 0）
    expect(splitPhone('+66812345678')).toEqual({ countryCode: '+66', phone: '812345678' })
    // 不带区号时按默认区号补
    expect(splitPhone('0812345678', '+66')).toEqual({ countryCode: '+66', phone: '0812345678' })
    expect(splitPhone('')).toBeNull()
    expect(splitPhone(null)).toBeNull()
  })

  it('SM-10 发货短信：订单状态变更后真的发出去了', async () => {
    const { User, Product } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const token = TestHelpers.generateToken(user)
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 100, price: 100, status: 'active' })
    )
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '短信测试',
        contact_phone: '+66812345010',
        delivery_address: 'A',
        terms_accepted: true,
        age_confirmed: true
      })
    expect(orderRes.status).toBe(201)
    const orderId = orderRes.body.data.order.id

    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const res = await request(app)
      .put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${TestHelpers.generateAdminToken(admin)}`)
      .send({ status: 'shipped', tracking_number: 'SF998877' })

    expect(res.status).toBe(200)
    // 业务成功是前提
    const { Order } = models()
    expect((await Order.findByPk(orderId)).status).toBe('shipped')

    // 短信也发出去了，且内容带订单号与物流单号
    const rows = await SmsLog.findAll({ where: { template: SMS_EVENTS.ORDER_SHIPPED } })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].message).toContain('SF998877')
  })

  it('SM-11 同一号码的两单在冷却期内先后发货：两单都发出去', async () => {
    const vars = { order_no: 'ORD-A', contact_name: 'A', tracking_number: 'SF-A' }
    const a = await sendSms({
      phone: '+66812345012',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars,
      dedupeKey: 'ORD-A'
    })
    const b = await sendSms({
      phone: '+66812345012',
      template: SMS_EVENTS.ORDER_SHIPPED,
      vars: { order_no: 'ORD-B', contact_name: 'A', tracking_number: 'SF-B' },
      dedupeKey: 'ORD-B'
    })

    expect(a.sent).toBe(true)
    // 冷却的本意是"同一订单别刷屏"，不是"同一号码 5 分钟内只能收一条"
    expect(b.sent, '第二单被第一单的冷却挡掉了 —— 客户收不到第二单的通知').toBe(true)
    expect(sent.length).toBe(2)
  })

  it('SM-12 密码重置连着请求两次：两条短信都发出去（不能被冷却锁死）', async () => {
    const { createPasswordResetOtp } = await import('@server/services/passwordResetService.js')
    const { User } = models()
    const user = await User.create(await TestDataFactory.createUser())

    await createPasswordResetOtp(user, '+66', '812345011')
    await createPasswordResetOtp(user, '+66', '812345011')

    expect(sent.length, '第二次重置的验证码没发出去 —— 用户手上那条已作废，等于被锁死').toBe(2)
    expect(sent[0].body.template).toBe(SMS_EVENTS.PASSWORD_RESET)
    expect(sent[1].body.template).toBe(SMS_EVENTS.PASSWORD_RESET)

    // 两条短信里的验证码必须不同：用户用的是**最新**那条
    const otpA = (sent[0].body.message.match(/\d{6}/) || [])[0]
    const otpB = (sent[1].body.message.match(/\d{6}/) || [])[0]
    expect(otpA).toBeTruthy()
    expect(otpB).toBeTruthy()
    expect(otpA).not.toBe(otpB)
  })

  it('SM-13 没有物流单号时，三种语言的短信里都不出现占位符', async () => {
    // 三种语言都要查：模板是按区号选的，只测一种语言会漏掉另一种的写法
    const cases = [
      { phone: '+66812345013', locale: 'th-TH' },
      { phone: '+8613812345013', locale: 'zh-CN' },
      { phone: '+60123450013', locale: 'en-US' }
    ]
    for (const c of cases) {
      await sendSms({
        phone: c.phone,
        template: SMS_EVENTS.ORDER_SHIPPED,
        vars: { order_no: 'ORD-X', contact_name: 'X' },
        dedupeKey: 'ORD-X'
      })
    }

    expect(sent.length).toBe(3)
    for (let i = 0; i < sent.length; i++) {
      const msg = sent[i].body.message
      expect(sent[i].body.locale).toBe(cases[i].locale)
      // 客户收到"物流单号：{tracking_number}"比不发短信还糟
      expect(msg, `${cases[i].locale} 文案里出现了占位符`).not.toContain('{')
      expect(msg, `${cases[i].locale} 文案里出现了变量名`).not.toContain('tracking')
      expect(msg).toContain('ORD-X')
    }
  })

  it('SM-14 状态映射不反：已发货发"已发货"，已送达发"已送达"', async () => {
    process.env.SMS_BUSINESS_EVENTS = 'order_shipped,order_delivered'

    const { User, Product } = models()
    const user = await User.create(await TestDataFactory.createUser())
    const token = TestHelpers.generateToken(user)
    const product = await Product.create(
      TestDataFactory.createProduct({ stock: 100, price: 100, status: 'active' })
    )
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: product.id, quantity: 1 }],
        contact_name: '短信测试',
        contact_phone: '+66812345014',
        delivery_address: 'A',
        terms_accepted: true,
        age_confirmed: true
      })
    expect(orderRes.status).toBe(201)
    const orderId = orderRes.body.data.order.id

    const admin = await TestHelpers.createAdminUser({ role: 'admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)

    await request(app)
      .put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipped', tracking_number: 'SF112233' })
    await request(app)
      .put(`/api/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'delivered' })

    const shipped = await SmsLog.findAll({ where: { template: SMS_EVENTS.ORDER_SHIPPED } })
    const delivered = await SmsLog.findAll({ where: { template: SMS_EVENTS.ORDER_DELIVERED } })

    expect(shipped.length).toBe(1)
    expect(delivered.length).toBe(1)
    // 发货短信带运单号；送达短信不带
    expect(shipped[0].message).toContain('SF112233')
    expect(delivered[0].message).not.toContain('SF112233')
  })
})
