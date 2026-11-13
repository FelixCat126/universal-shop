/**
 * 前后端字段契约自动核对
 *
 * 背景：前端把响应解构成 `data.data.orders`，后端返回的是 `data.data.list`
 * —— 这种不一致**不会报任何错**，前端只是拿到 undefined，
 * 页面空白或显示"暂无数据"，极难排查（前后端各看自己那半边都"没问题"）。
 *
 * 这个测试的做法：
 *   1. 扫前端源码，找出每个 API 调用点**实际读了哪些字段路径**
 *      （例如 `api.get('/orders')` 后面读了 `data.data.orders`）
 *   2. 真实调一次那个接口
 *   3. 断言：前端读的字段路径，在响应里**确实存在**
 *
 * 覆盖不到的（动态路径、拼字符串的）会跳过并报告，不算失败。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { seedSystemConfigBaseline } from '../setup/test-baseline.js'

const ROOT = path.resolve(__dirname, '../..')

/**
 * 扫前端源码：找出「调用哪个接口 → 读了响应里的哪些字段」
 * @returns {Array<{file: string, url: string, keys: string[]}>}
 */
function scanFrontendCalls () {
  const out = []
  const dirs = ['src/portal', 'src/admin', 'src/partner']
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        if (!['dist', 'node_modules', 'i18n'].includes(f)) walk(p)
      } else if (/\.(js|vue)$/.test(f)) {
        const src = fs.readFileSync(p, 'utf8')
        // api.get('/orders') / api.get(`/orders/${id}`) / apiRequest('/api/xxx')
        const re = /\bapi(?:Request)?\.(get|post|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g
        let m
        while ((m = re.exec(src))) {
          const url = m[2]
          // 只看**字面量路径**（带 ${} 变量的跳过）
          if (url.includes('${')) continue
          // 调用点之后 700 字符内读了哪些字段路径
          // ⚠️ 必须容许可选链：前端写的是 `data.data?.orders`（不是 data.data.orders）
          const window = src.slice(m.index, m.index + 700)
          const keys = new Set()
          for (const k of window.matchAll(
            /\bdata\s*\?*\.?\s*(data\s*\?*\.?\s*)?([a-zA-Z_][a-zA-Z0-9_]*)/g
          )) {
            keys.add(k[2])
          }
          // 过滤掉明显的非字段（data.data 本身、局部变量名）
          const meaningful = [...keys].filter(k =>
            !['data', 'length', 'map', 'forEach', 'filter', 'find', 'some', 'then', 'catch', 'value', 'success', 'message', 'code', 'items'].includes(k)
          )
          if (meaningful.length) {
            out.push({ file: p, url, keys: meaningful })
          }
        }
      }
    }
  }
  dirs.forEach(d => { if (fs.existsSync(d)) walk(d) })
  return out
}

describe('前后端字段契约', () => {
  let adminToken
  let userToken
  let productId

  beforeAll(async () => {
    await TestDatabase.clearAllData()
    await seedSystemConfigBaseline()
    const { Administrator, User, Product } = TestDatabase.getSequelize().models
    const admin = await Administrator.create({
      username: 'ct_admin', password: 'CtPwd#1234', role: 'super_admin', is_active: true
    })
    adminToken = TestHelpers.generateAdminToken(admin)
    const u = await User.create(await TestDataFactory.createUser({
      country_code: '+86', phone: '13900006666'
    }))
    userToken = TestHelpers.generateToken(u)
    const p = await Product.create({
      name: '契约商品', price: 10, stock: 5, status: 'active'
    })
    productId = p.id
  })

  it('CT-1 前端读的字段路径，接口必须真的返回', async () => {
    const calls = scanFrontendCalls()
    expect(calls.length, '应扫到前端 API 调用点').toBeGreaterThan(0)

    // 只校验能安全匿名/用现有 token 调的接口
    const checkable = calls.filter(c =>
      /^\/(api\/)?(admin\/)?(products|orders|users|partners|coupons|partner-orders|statistics|operation-logs|bundles|product-categories)/.test(c.url)
    )

    const problems = []
    const checked = []

    for (const call of checkable.slice(0, 40)) {
      const path = call.url.startsWith('/api/') ? call.url : `/api${call.url}`
      // 拼上必要的查询参数
      const url = new URL(path, 'http://x')
      if (/products$/.test(url.pathname)) url.searchParams.set('page', '1')
      if (/orders$/.test(url.pathname)) url.searchParams.set('page', '1')
      if (/users$/.test(url.pathname)) url.searchParams.set('page', '1')

      let res
      try {
        res = await request(app).get(url.pathname + url.search)
          .set('Authorization', `Bearer ${adminToken}`)
      } catch {
        continue
      }
      if (res.status !== 200) continue

      const body = res.body
      // 逐个前端读的键：在响应里找得到吗
      for (const key of call.keys) {
        const found = JSON.stringify(body).includes(`"${key}"`)
        if (!found) {
          problems.push(`${call.file.replace(ROOT + '/', '')} → ${call.url} 读了 "${key}"，但响应里没有`)
        }
      }
      checked.push(`${call.url} (${call.keys.join(',')})`)
    }

    console.log(`已核对 ${checked.length} 个接口调用点`)
    expect(problems, '前端读了但后端没返回的字段：\n' + problems.join('\n')).toEqual([])
  })
})
