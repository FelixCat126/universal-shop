/**
 * 管理端写接口的**入参边界**：越界输入必须返回 400，不能返回 500
 *
 * ## 背景
 *
 * 34 个管理端写路由里只有 9 个挂了 joi 校验，其余靠控制器手工检查。
 * 没校验的那些，超长字符串会直接撞 PG 的 varchar 长度：
 *
 *   value too long for type character varying(50)
 *
 * Sequelize 把它当普通异常抛出 → 控制器的 catch 统一回 **500** →
 * 客户端看到"服务器内部错误"，完全不知道是自己输入太长；
 * 日志里还留一条带 stack 的 error，把真错误淹掉。
 *
 * 现在这些走 `respondDbError`（src/server/utils/dbInputError.js）：
 * 数据库层的"坏输入"错误码（22001/22003/22P02/23502/23503/23514）
 * 与 Sequelize 的字段校验错误 → 翻译成 400 + 一句中文提示。
 *
 * ## 覆盖方式
 *
 * 逐个管理端写接口喂超长/越界值，断言 **不是 5xx**。
 * 不写死具体的 400 之外的文案 —— 文案会变，状态码语义不会。
 *
 *   IB-1 各管理端写接口：超长输入不得返回 5xx
 *   IB-2 错误文案是人话（不是 Sequelize 的英文技术语，也不是空）
 *   IB-3 翻译层本身：PG 错误码 → 400；未知错误 → 500（不许一律吞成 400）
 *   IB-4 用户端写接口同样适用（顾客看到 500 比运营看到更致命）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { translateDbInputError } from '@server/utils/dbInputError.js'

const models = () => TestDatabase.getSequelize().models

let token
let productId
let categoryId
let adminId

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)
  adminId = admin.id
  const p = await models().Product.create({ name: '边界商品', price: 10, stock: 10, status: 'active' })
  productId = p.id
  const c = await models().ProductCategory.create({ name: '边界分类', sort_order: 0 })
  categoryId = c.id
})

const LONG = 'x'.repeat(600)

/** 所有接受自由文本的管理端写接口 */
function writeEndpoints () {
  return [
    { label: '创建管理员', method: 'post', url: '/api/admin/administrators', body: { username: LONG, password: 'Abcd1234' } },
    { label: '更新管理员', method: 'put', url: `/api/admin/administrators/${adminId}`, body: { email: `${LONG}@x.com` } },
    { label: '创建合作方', method: 'post', url: '/api/admin/partners', body: { login: LONG, password: 'Abcd1234', display_name: 'x' } },
    { label: '更新合作方', method: 'put', url: '/api/admin/partners/1', body: { display_name: LONG } },
    { label: '创建分类', method: 'post', url: '/api/admin/product-categories', body: { name: LONG } },
    { label: '更新分类', method: 'put', url: `/api/admin/product-categories/${categoryId}`, body: { name: LONG } },
    { label: '创建商品', method: 'post', url: '/api/products', body: { name: LONG, price: 10, stock: 1 } },
    { label: '更新商品', method: 'put', url: `/api/products/${productId}`, body: { name: LONG } },
    { label: '创建促销', method: 'post', url: '/api/admin/promotions', body: { name: LONG, type: 'threshold', rules: { tiers: [{ min: 1, off: 1 }] } } },
    { label: '创建券模板', method: 'post', url: '/api/admin/coupon-templates', body: { name: LONG, type: 'discount', amount: 10, min_spend: 0 } },
    { label: '创建组合包', method: 'post', url: '/api/admin/bundles', body: { name: LONG, price: 10 } }
  ]
}

describe('管理端入参边界', () => {
  it('IB-1 超长输入不得返回 5xx', async () => {
    const bad = []
    const results = []
    for (const ep of writeEndpoints()) {
      const res = await request(app)[ep.method](ep.url)
        .set('Authorization', `Bearer ${token}`)
        .send(ep.body)
      results.push({ label: ep.label, status: res.status, message: String(res.body?.message || '') })
      if (res.status >= 500) bad.push(`${ep.label} → ${res.status}（${String(res.body?.message || '').slice(0, 60)}）`)
    }
    console.log('[IB]', results.map(r => `${r.label}:${r.status}`).join(' | '))
    expect(bad, '越界输入返回了 5xx（应翻译成 400）：\n' + bad.join('\n')).toEqual([])
  })

  it('IB-2 错误文案是人话（不含 Sequelize 英文技术语）', async () => {
    const bad = []
    for (const ep of writeEndpoints()) {
      const res = await request(app)[ep.method](ep.url)
        .set('Authorization', `Bearer ${token}`)
        .send(ep.body)
      if (res.status < 400 || res.status >= 500) continue
      const msg = String(res.body?.message || '')
      if (!msg) bad.push(`${ep.label}：400 但没有提示文案`)
      if (/Validation \w+ on \w+ failed/i.test(msg)) {
        bad.push(`${ep.label}：透出了 Sequelize 英文技术语 → ${msg}`)
      }
    }
    expect(bad, '错误提示不可读：\n' + bad.join('\n')).toEqual([])
  })

  it('IB-3 翻译层：PG 错误码 → 400；未知错误仍走 500', () => {
    // 超长
    const tooLong = translateDbInputError({ parent: { code: '22001' }, message: 'value too long for type character varying(50)' })
    expect(tooLong?.status).toBe(400)
    expect(tooLong?.message).toBeTruthy()

    // 数值越界 / 格式非法 / 外键 / 非空
    for (const code of ['22003', '22P02', '23502', '23503', '23514']) {
      const t = translateDbInputError({ parent: { code }, message: 'x' })
      expect(t?.status, `${code} 应翻译成 400`).toBe(400)
    }

    // Sequelize 字段校验错误 → 400 + 中文
    const validation = translateDbInputError({
      name: 'SequelizeValidationError',
      errors: [{ path: 'username', message: 'Validation len on username failed' }]
    })
    expect(validation?.status).toBe(400)
    expect(validation?.message).not.toMatch(/Validation \w+ on/)

    // 真正的服务端错误 → 不许被翻译成 400（否则真故障会被伪装成"用户输入问题"）
    const unknown = translateDbInputError({ message: 'ECONNREFUSED 127.0.0.1:5432' })
    expect(unknown).toBeNull()
    expect(translateDbInputError(null)).toBeNull()
  })
})

describe('用户端入参边界', () => {
  it('IB-4 用户端写接口：超长输入不得返回 5xx', async () => {
    const { User } = models()
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13900004444'
    }))
    const userToken = TestHelpers.generateToken(u)

    const base = { contact_name: '张三', contact_phone: '812345678', detail_address: '地址' }
    const cases = [
      { label: '地址-姓名超长', url: '/api/addresses', body: { ...base, contact_name: LONG } },
      { label: '地址-省份超长', url: '/api/addresses', body: { ...base, province: LONG } },
      { label: '地址-城市超长', url: '/api/addresses', body: { ...base, city: LONG } },
      { label: '地址-区县超长', url: '/api/addresses', body: { ...base, district: LONG } }
    ]
    const bad = []
    for (const c of cases) {
      const res = await request(app).post(c.url)
        .set('Authorization', `Bearer ${userToken}`)
        .send(c.body)
      if (res.status >= 500) bad.push(`${c.label} → ${res.status}（${String(res.body?.message || '').slice(0, 60)}）`)
    }
    expect(bad, '用户端越界输入返回了 5xx（顾客只会看到"服务器内部错误"）：\n' + bad.join('\n')).toEqual([])
  })
})
