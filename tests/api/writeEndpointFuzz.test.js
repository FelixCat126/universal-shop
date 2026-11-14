/**
 * 写接口的**坏入参**护栏（通用 fuzz）
 *
 * ## 为什么要有这个
 *
 * 第 15 轮手工发现"超长输入 → 500"（管理端 4 处 + 用户端 2 处），
 * 修法是加了统一的错误翻译层（`utils/dbInputError.js`）。
 * 但那次是**手挑接口**查的 —— 将来新增接口时，谁知道它有没有同样的问题？
 *
 * 这里改成**全量扫**：把每个写接口都用几组恶意入参打一遍，
 * 任何 5xx 都是"客户端输入问题被当成服务端故障"。
 *
 * ## 断言两件事
 *
 * 1. **不许返 5xx**：坏输入是客户端的问题，应该是 4xx。
 * 2. **不许泄漏内部细节**：响应里不能出现堆栈帧或 PG/Sequelize 的错误文本
 *    （"SequelizeDatabaseError"、"at Object."、SQL 片段…）——
 *    这些对攻击者是信息，对用户是噪声。
 *
 * 跑在测试库上；只发不会产生业务副作用的坏数据。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { collectRoutes } from '@server/utils/routeInventory.js'

// 长度取「刚好超过字段上限」：
//   - 太长（几百 KB × 几十个字段）→ 请求体会超过 1MB 上限 → 被 413 提前拦下，
//     请求根本进不到控制器 → 探针形同虚设（第 15 轮那类 bug 反而测不到）；
//   - 太短 → 字段值合法，控制器不会报错 → 也测不到。
//   300 字符能越过 varchar(50/64/100) 的限制，同时请求体仍在限额内。
const LONG = 'x'.repeat(300)

/** 恶意入参组：每组都覆盖常见的字段名 */
const HOSTILE_BODIES = [
  { label: '超长字符串', body: { name: LONG, title: LONG, email: LONG, description: LONG, note: LONG, address: LONG, phone: LONG, password: LONG, username: LONG, login: LONG, display_name: LONG, nickname: LONG, real_name: LONG, reason: LONG, tracking_number: LONG, admin_note: LONG, content: LONG, message: LONG, code: LONG, key: LONG, value: LONG, category: LONG, alias: LONG, name_th: LONG, detail_address: LONG, contact_name: LONG, contact_phone: LONG, comments: LONG, remark: LONG, label: LONG, title_zh: LONG } },
  { label: '负数', body: { id: -1, price: -99999, stock: -5, quantity: -3, discount: -100, amount: -1, page: -1, limit: -1 } },
  { label: 'NaN 串', body: { id: 'abc', price: 'abc', stock: 'abc', quantity: 'abc', status: 'abc', page: 'abc' } },
  { label: 'null', body: { id: null, name: null, price: null, stock: null, quantity: null, status: null, items: null } },
  { label: '结构错乱', body: { id: { a: 1 }, name: [1, 2], price: { x: 'y' }, items: 'not-an-array', quantity: { n: 1 }, status: ['pending'] } },
  { label: '超长数字', body: { id: '9'.repeat(300), price: 1e308, quantity: 1e308 } },
  { label: '原型污染', body: { __proto__: { is_admin: true, role: 'super_admin' }, constructor: { prototype: { is_admin: true } }, is_admin: true } },
  { label: 'SQL 注入串', body: { name: "' OR 1=1 --", email: "a@b.com' UNION SELECT * FROM users --", order_no: "x'; DROP TABLE orders; --", keyword: "%' OR '1'='1" } },
  { label: '深层嵌套', body: { items: [{ product_id: { a: { b: { c: 1 } } } }], meta: { a: { b: { c: { d: 1 } } } } } }
]

/** 跳过的路由（文件上传 / 导入导出 / 需要特殊前置） */
const SKIP = [
  '/import', '/export', 'avatar', 'product-image', '/init'
]

/** 响应里不该出现的内部细节 */
const LEAK_PATTERNS = [
  /SequelizeDatabaseError/i,
  /SequelizeValidationError/i,
  /SequelizeForeignKeyConstraintError/i,
  /\bat\s+\/.*:\d+:\d+/,       // 堆栈帧
  /relation ".*" does not exist/i,
  /syntax error at or near/i,
  /duplicate key value/i
]

describe('写接口的坏入参', () => {
  let adminToken

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    adminToken = TestHelpers.generateAdminToken(admin)
  })

  it('FZZ-1 坏入参不得返 5xx，也不得泄漏内部细节', async () => {
    const routes = collectRoutes(app).filter(r =>
      ['POST', 'PUT', 'PATCH'].includes(r.method) && !SKIP.some(s => r.fullPath.includes(s))
    )
    const badStatus = []
    const leaks = []
    for (const route of routes) {
      const path = route.fullPath.replace(/:[a-zA-Z]+/g, '1')
      for (const hostile of HOSTILE_BODIES) {
        let res
        try {
          res = await request(app)[route.method.toLowerCase()](path)
            .set('Authorization', `Bearer ${adminToken}`)
            .send(hostile.body)
        } catch (e) {
          badStatus.push(`${route.method} ${path} [${hostile.label}] → 请求本身抛错: ${String(e.message).slice(0, 60)}`)
          continue
        }
        if (res.status >= 500) {
          badStatus.push(`${route.method} ${path} [${hostile.label}] → ${res.status} ${String(res.body?.message || '').slice(0, 60)}`)
        }
        const text = typeof res.body === 'object' ? JSON.stringify(res.body) : String(res.text || '')
        for (const re of LEAK_PATTERNS) {
          if (re.test(text)) {
            leaks.push(`${route.method} ${path} [${hostile.label}] → 响应泄漏内部细节: ${text.slice(0, 80)}`)
            break
          }
        }
      }
    }
    expect(
      badStatus,
      '坏入参导致 5xx（输入问题被当成服务端故障）：\n' + badStatus.join('\n')
    ).toEqual([])
    expect(
      leaks,
      '响应泄漏了内部细节（堆栈 / PG 错误）：\n' + leaks.join('\n')
    ).toEqual([])
  }, 300000)
})
