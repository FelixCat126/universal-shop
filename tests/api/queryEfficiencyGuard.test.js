/**
 * 查询效率护栏（第 49 轮）
 * ========================
 *
 * 效率问题有个特点：**不会报错，也不会白屏**，只是"慢一点、少传一点"，
 * 而且越到线上数据量大时越明显 —— 所以只能靠**结构性断言**盯着。
 *
 * ## 用例
 *   EG-1 客户的订单接口**绝不能**带 `admin_note`（运营内部备注）——
 *        这条既是效率（少传一个字段）也是**隐私**（内部备注不该给客户看）
 *   EG-2 关键列表接口必须有 limit（不能无上限地把整表拉出来）
 *   EG-3 低频变动、每次都查的接口必须挂缓存（行政区划 / 合作方 MOQ）
 *   EG-4 前端请求的 pageSize 不得超过服务端上限（否则是"静默截断"）
 *   EG-5 批量发券的预检必须**批量**查（不能每个用户查一次）
 *   EG-6 日志/分类/推荐码的搜索索引已建立（迁移 016）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { runMigrations } from '@server/migrations/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const models = () => TestDatabase.getSequelize().models

describe('查询效率护栏', () => {
  it('EG-1 客户侧订单接口不带 admin_note（内部备注），管理端要带', async () => {
    await TestDatabase.clearAllData()
    const { Order, Product } = models()
    const user = await models().User.create(await TestDataFactory.createUser({
      nickname: '效率客户', phone: '812345700', country_code: '+66'
    }))
    const token = TestHelpers.generateToken(user)
    const product = await Product.create(TestDataFactory.createProduct({ name: '效率商品', price: 10, stock: 5 }))
    const order = await Order.create({
      order_no: `EG${Date.now()}`,
      user_id: user.id,
      total_amount: 10,
      total_amount_thb: 10,
      currency_code: 'THB',
      payment_method: 'cod',
      status: 'shipping',
      contact_name: '效率客户',
      contact_phone: '13800138000',
      delivery_address: 'A',
      exchange_rate: 1,
      admin_note: '内部备注：客户疑似欺诈，不要发货'
    })
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    const adminToken = TestHelpers.generateAdminToken(admin)

    // 客户：列表与详情都不该带内部备注
    const list = await request(app).get('/api/orders?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    expect(JSON.stringify(list.body)).not.toContain('admin_note')
    expect(JSON.stringify(list.body)).not.toContain('疑似欺诈')

    const detail = await request(app).get(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(detail.status).toBe(200)
    expect(JSON.stringify(detail.body)).not.toContain('admin_note')
    expect(JSON.stringify(detail.body)).not.toContain('疑似欺诈')

    // 管理端：要能看到（那是给他们用的）
    const adminList = await request(app).get('/api/admin/orders?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminList.status).toBe(200)
    expect(JSON.stringify(adminList.body)).toContain('admin_note')
  })

  it('EG-2 关键列表接口必须有 limit', () => {
    const checks = [
      { file: 'src/server/controllers/cartController.js', marker: 'Cart.findAll' },
      { file: 'src/server/controllers/afterSaleController.js', marker: 'AfterSale.findAll' }
    ]
    const problems = []
    for (const c of checks) {
      const src = read(c.file)
      const i = src.indexOf(c.marker)
      expect(i, `${c.file} 里找不到 ${c.marker}`).toBeGreaterThan(-1)
      // 看这一段查询里有没有 limit
      const seg = src.slice(i, i + 2500)
      const end = seg.indexOf('})')
      const query = end > 0 ? seg.slice(0, end) : seg
      if (!/limit\s*:/.test(query)) {
        problems.push(`${c.file} 的 ${c.marker} 没有 limit（会随数据量无限增长）`)
      }
    }
    expect(problems, `列表接口缺 limit：\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('EG-3 低频变动的接口挂了缓存', () => {
    const regions = read('src/server/routes/administrativeRegions.js')
    // 行政区划：数据近乎静态，每次打开地址表单都要打
    for (const p of ['/provinces', '/provinces/:id/districts', '/districts/:id/sub-districts']) {
      const line = regions.split('\n').find(l => l.includes(`router.get('${p}'`))
      expect(line, `找不到路由 ${p}`).toBeTruthy()
      expect(line, `${p} 没有挂缓存（每次打开地址表单都查库）`).toContain('cacheGet')
    }
    // 合作方 MOQ：走 SystemConfig.getConfig（有 10s LRU + 写时失效），不能裸查
    // ⚠️ 只看**代码行**（注释里会提到"原来这里是裸 findOne" → 不能算命中）
    const moqCode = read('src/server/utils/partnerMoq.js')
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(moqCode, '合作方 MOQ 绕过了 SystemConfig.getConfig 的缓存层').toContain('SystemConfig.getConfig')
    expect(moqCode, '合作方 MOQ 不该再裸查 SystemConfig').not.toContain('SystemConfig.findOne')
  })

  it('EG-4 前端请求的 pageSize 不超过服务端上限（否则是静默截断）', () => {
    const SERVER_MAX = 100
    const problems = []
    for (const dir of ['src/admin/views', 'src/portal/views', 'src/partner/views']) {
      const abs = path.join(ROOT, dir)
      if (!fs.existsSync(abs)) continue
      for (const f of fs.readdirSync(abs)) {
        if (!f.endsWith('.vue')) continue
        const src = fs.readFileSync(path.join(abs, f), 'utf8')
        for (const m of src.matchAll(/pageSize:\s*(\d+)/g)) {
          if (Number(m[1]) > SERVER_MAX) {
            problems.push(`${dir}/${f} —— 请求 pageSize=${m[1]}，服务端上限 ${SERVER_MAX}（会被静默截断）`)
          }
        }
      }
    }
    expect(problems, `pageSize 超过服务端上限：\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('EG-5 批量发券的预检是批量的（不逐用户查库）', () => {
    const src = read('src/server/services/couponService.js')
    // 逐用户预检的写法：for 循环里调 assertIssuable
    const loop = src.match(/for \([^)]*\)[\s\S]{0,400}?assertIssuable\(/g)
    expect(
      loop,
      `发券预检又在循环里逐用户查库了（N 个用户 = 2N 次 COUNT）`
    ).toBeNull()
    // 批量写法：一次 GROUP BY 拿所有用户的已领数
    expect(src, '发券预检应改成批量 GROUP BY').toContain("group: ['user_id']")
  })

  it('EG-6 搜索与清理用的索引已建立（迁移 016）', async () => {
    const sequelize = TestDatabase.getSequelize()
    await runMigrations({ sequelize })
    const schema = sequelize.options.schema
    const expected = [
      'idx_audit_log_event_trgm',
      'idx_operation_log_action_trgm',
      'idx_product_category_name_trgm',
      'idx_user_referred_by_code_trgm',
      'idx_user_email_trgm',
      'idx_point_transaction_created_at',
      'idx_user_coupon_updated_at',
      'idx_cart_updated_at',
      'idx_product_category_sort_order',
      'idx_user_point_balance_balance'
    ]
    const placeholders = expected.map((_, i) => `:n${i}`).join(', ')
    const replacements = { s: schema }
    expected.forEach((n, i) => { replacements[`n${i}`] = n })
    const rows = await sequelize.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = :s AND indexname IN (${placeholders})`,
      { replacements }
    )
    const names = (rows[0] || []).map(r => r.indexname)
    expect(names.length, `缺少索引：${10 - names.length} 个`).toBe(10)
  })
})
