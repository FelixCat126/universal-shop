/**
 * 深翻页防护（所有分页接口的 offset 必须有上限）
 *
 * ## 发现的 bug
 *
 * 项目里有**统一分页工具** `src/server/utils/pagination.js`，它明确处理了深翻页：
 *   page ≤ maxPage(10000)，offset ≤ maxOffset(100000)
 * 工具的注释写得很清楚：
 *   "page 也必须有上限：limit 有上限但 page 没有时，page=999999999 会产生近亿
 *    OFFSET —— PG 必须顺序扫过整表再丢弃，叠加 findAndCountAll 的 COUNT(*)
 *    就是两次全表扫描。"
 *
 * 但**有 6 处接口没有走这个工具**，而是各自手写解析：
 *   `const page = Math.max(1, parseInt(req.query.page, 10) || 1)`
 *   —— 只有下限，**没有上限**。于是 `?page=999999999` 直接算出近亿 OFFSET，
 *   打到数据库上就是"扫全表 + 再 COUNT 一次"。
 *
 * 已修的 6 处：
 *   orderController.getMyOrders          （用户端我的订单）
 *   pointsController.listTransactions     （积分流水）
 *   productCategoryController.listAdmin   （后台商品类别）
 *   partnerAdminController.listPartnerOrders（后台合作方订单）
 *   partnerPortalController（商品列表 / 订单列表 两处）
 *
 * ## 为什么断言"实际下发的 SQL"
 *
 * 只断言"接口返回 200"是**假绿**：没有上限时 PG 也可能很快返回（表小）。
 * 所以这里捕获真实 SQL，断言 OFFSET 的数值上限 —— 这是确定性的，
 * 且能反向验证（把工具的钳制去掉，断言立刻红）。
 *
 * ## 护栏还有一条"防退化"扫描
 *
 * 静态扫描所有控制器：不允许再出现手写的分页参数解析。
 * 新加接口时若绕过 resolvePagination，扫描会红。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import { resolvePagination } from '@server/utils/pagination.js'

const models = () => TestDatabase.getSequelize().models

let user
let token
let captured = []
let originalLogging = null

/** 捕获真实下发的 SQL（用于断言 OFFSET 上限） */
function captureSql () {
  const seq = TestDatabase.getSequelize()
  originalLogging = seq.options.logging
  captured = []
  seq.options.logging = (sql) => { captured.push(sql) }
}

function restoreLogging () {
  const seq = TestDatabase.getSequelize()
  if (originalLogging !== null) seq.options.logging = originalLogging
}

/** 从捕获的 SQL 里取出最大的 OFFSET 数值；没有 OFFSET 返回 0 */
function maxOffsetIn (sqls) {
  let max = 0
  for (const sql of sqls) {
    const m = /OFFSET\s+"?(\d+)"?/i.exec(sql)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900007777'
  }))
  token = TestHelpers.generateToken(user)
  captureSql()
})

afterEach(() => {
  restoreLogging()
})

describe('深翻页防护 · 统一分页工具', () => {
  it('PG-1 超大 page 被钳到 maxPage，offset 不超过 maxOffset', () => {
    const r = resolvePagination({ page: '999999999', pageSize: '100' })
    expect(r.page, 'page 必须被钳住，不能原样透传').toBeLessThanOrEqual(10000)
    expect(r.offset, 'offset 必须被钳住（深翻页会扫全表）').toBeLessThanOrEqual(100000)
    expect(r.limit, 'limit 必须不超过 maxPageSize').toBeLessThanOrEqual(100)
  })

  it('PG-2 非法输入回退到默认值，不产生 NaN/负数', () => {
    const r = resolvePagination({ page: 'abc', pageSize: '-5' })
    expect(r.page).toBe(1)
    expect(r.limit).toBeGreaterThanOrEqual(1)
    expect(r.offset).toBe(0)
  })

  it('PG-3 pageSize 超上限时被钳住', () => {
    const r = resolvePagination({ page: '1', pageSize: '99999' })
    expect(r.limit).toBe(100)
  })
})

describe('深翻页防护 · 实际接口下发的 SQL', () => {
  it('PG-4 用户端订单列表：page=999999999 时 OFFSET 被钳住', async () => {
    const res = await request(app).get('/api/orders?page=999999999&limit=100')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const maxOffset = maxOffsetIn(captured)
    expect(maxOffset, '实际下发的 OFFSET 过大 —— 深翻页会打穿数据库').toBeLessThanOrEqual(100000)
  })

  it('PG-5 积分流水：page=999999999 时 OFFSET 被钳住', async () => {
    const res = await request(app).get('/api/users/points/transactions?page=999999999&limit=100')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const maxOffset = maxOffsetIn(captured)
    expect(maxOffset, '实际下发的 OFFSET 过大').toBeLessThanOrEqual(100000)
  })

  it('PG-6 正常分页不受影响（page=2 & pageSize=2 → offset=2）', async () => {
    for (let i = 0; i < 5; i++) {
      await models().Order.create({
        order_no: `PG${Date.now()}${i}`,
        user_id: user.id,
        total_amount: 100,
        total_amount_thb: 100,
        currency_code: 'THB',
        payment_method: 'cod',
        status: 'pending',
        contact_name: '深翻页',
        contact_phone: '13800138000',
        delivery_address: 'A',
        exchange_rate: 1
      })
    }
    const res = await request(app).get('/api/orders?page=2&limit=2')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(maxOffsetIn(captured), '正常翻页的 offset 应等于 (page-1)*limit').toBe(2)
    expect(res.body?.data?.orders?.length).toBe(2)
  })
})

describe('深翻页防护 · 防退化扫描', () => {
  it('PG-7 控制器里不允许再出现手写的分页参数解析', () => {
    const dir = path.resolve('src/server/controllers')
    const offenders = []
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const full = path.join(d, name)
        if (fs.statSync(full).isDirectory()) { walk(full); continue }
        if (!name.endsWith('.js')) continue
        const text = fs.readFileSync(full, 'utf8')
        // 手写解析的典型形态：直接 parseInt(req.query.page / pageSize / limit)
        if (/parseInt\(\s*(String\(\s*)?req\.query\.(page|pageSize|limit)\b/.test(text)) {
          offenders.push(path.relative(process.cwd(), full))
        }
      }
    }
    walk(dir)
    expect(
      offenders,
      '这些控制器绕过了 resolvePagination（page 无上限 → 深翻页放大）：\n' + offenders.join('\n')
    ).toEqual([])
  })

  it('PG-8 分页工具本身的上限默认值不能被放宽', () => {
    const r = resolvePagination({ page: String(10 ** 9), pageSize: String(10 ** 9) })
    expect(r.page).toBeLessThanOrEqual(10000)
    expect(r.offset).toBeLessThanOrEqual(100000)
    expect(r.limit).toBeLessThanOrEqual(100)
  })
})
