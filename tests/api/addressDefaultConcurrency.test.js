/**
 * 地址「默认项」的**并发**护栏
 *
 * ## 发现的 bug
 *
 * 设默认是「先把该用户所有地址清成非默认，再把目标设为默认」**两步**，
 * 而这两步之间**没有锁**。两个设备同时操作（双击 / 两台手机）会交错：
 *
 *   T1 清理全部 → T1 设 A → T2 清理全部（把 A 又清掉）→ T2 设 B
 *
 * 结果可能是**两个默认地址**，或者**一个默认都没有**。
 * 合作方地址那边一直锁着 Partner 行，用户这边漏了。
 *
 * ## 为什么主用例不能靠"多跑几轮"
 *
 * 实测无修复时的**触发率只有 0.7%**（150 轮 3 并发才出现 1 次）——
 * 靠时序的护栏是"永远绿的测试"：单次运行大概率抓不住，看着绿其实没在守。
 *
 * 所以主用例改成**确定性**的：
 * **在另一个事务里把用户行锁住，再发起设默认请求** ——
 * 如果接口确实要拿这把锁，请求就**必须等待**（可观测地阻塞）；
 * 拿不到锁的接口会**立刻返回** → 断言直接失败，不靠运气。
 *
 *   AD-1 设默认必须等用户行锁（确定性：阻塞 → 拿得到锁）
 *   AD-2 改地址 / 删地址 / 新建地址也必须拿同一把锁（同样确定性）
 *   AD-3 并发跑 60 轮，最终恰好一个默认地址（统计性补充）
 *   AD-4 串行操作不受影响
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { TestDataFactory } from '../factories/index.js'
import sequelize from '@server/config/database.js'
import User from '@server/models/User.js'

const models = () => TestDatabase.getSequelize().models

let user
let token
let addrA
let addrB

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

beforeEach(async () => {
  await TestDatabase.clearAllData()
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900008888'
  }))
  token = TestHelpers.generateToken(user)
  addrA = await models().Address.create({
    user_id: user.id, contact_name: 'A', contact_phone: '13800138000',
    detail_address: 'A', full_address: 'A', is_default: true
  })
  addrB = await models().Address.create({
    user_id: user.id, contact_name: 'B', contact_phone: '13800138000',
    detail_address: 'B', full_address: 'B', is_default: false
  })
})

/**
 * 断言「这个请求会等用户行锁」。
 *
 * 做法：另开一个事务把用户行锁住 → 请求必须阻塞 → 放开锁后请求才完成。
 *
 * ⚠️ 三个容易把它变成"假绿"的坑，这里都堵上了：
 *
 * 1. **连接池冷启动**：第一个请求要建连接 + 预热，可能要几百毫秒 ——
 *    看起来像"被锁住了"，其实只是慢。所以**先发一个热身请求**把池子烧热。
 *
 * 2. **外键也会造成阻塞（最隐蔽的一个）**：addresses.user_id → users.id 是外键，
 *    PG 在 UPDATE 地址行时会顺带对 users 行加 **KEY SHARE** 锁；
 *    而 KEY SHARE 与 **FOR UPDATE 冲突** → 即便接口**没有**FOR UPDATE 锁，
 *    请求照样会阻塞 → 断言"它阻塞了"就成立 → **假绿**。
 *    所以 blocker 必须用 **FOR NO KEY UPDATE**：
 *    它与 FOR UPDATE 冲突、但**不与 KEY SHARE 冲突** ——
 *    于是"阻塞"就只可能来自接口自己拿的 FOR UPDATE 锁。
 *
 * 3. **窗口太短**：请求只是慢、还没到锁点 → 误判成"在等锁"。
 *    窗口取 1200ms，并且断言窗口内请求**确实没完成**。
 */
async function expectBlocksOnUserLock (runRequest) {
  // 热身：把连接池烧热，避免第一个请求的冷启动被误读成"被锁住"
  await request(app).get('/api/addresses').set('Authorization', `Bearer ${token}`)

  const blocker = await sequelize.transaction()
  // NO KEY UPDATE 而不是 UPDATE —— 见上面第 2 点（外键的 KEY SHARE 会造成假阻塞）
  await User.findByPk(user.id, { transaction: blocker, lock: blocker.LOCK.NO_KEY_UPDATE })

  const pending = runRequest().then(r => ({ settled: true, res: r }))
  const outcome = await Promise.race([
    pending,
    sleep(1200).then(() => ({ settled: false }))
  ])

  try {
    await blocker.rollback()
  } catch { /* 忽略 */ }
  if (!outcome.settled) {
    // 放开锁后请求应当完成
    const res = (await pending).res
    return { blocked: true, res }
  }
  return { blocked: false, res: outcome.res }
}

describe('地址默认项的并发', () => {
  it('AD-1 设默认必须等用户行锁', async () => {
    const out = await expectBlocksOnUserLock(() =>
      request(app).put(`/api/addresses/${addrB.id}/default`).set('Authorization', `Bearer ${token}`)
    )
    expect(out.blocked, '设默认没有等用户行锁 —— 并发时会出现"两个默认"或"没有默认"').toBe(true)
    expect(out.res?.status).toBe(200)
  })

  it('AD-2 改地址 / 删地址 / 新建地址也必须等同一把锁', async () => {
    const cases = [
      ['改地址', () => request(app).put(`/api/addresses/${addrA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ contact_name: 'A2', contact_phone: '13800138000', detail_address: 'A2' })],
      ['删地址', () => request(app).delete(`/api/addresses/${addrA.id}`)
        .set('Authorization', `Bearer ${token}`)],
      ['新建地址', () => request(app).post('/api/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({ contact_name: 'C', contact_phone: '13800138000', detail_address: 'C' })]
    ]
    for (const [label, run] of cases) {
      const out = await expectBlocksOnUserLock(run)
      expect(out.blocked, `${label} 没有等用户行锁`).toBe(true)
    }
  })

  it('AD-3 并发跑 60 轮，最终恰好一个默认地址', async () => {
    const twoDefaults = []
    const zeroDefaults = []
    for (let round = 0; round < 60; round++) {
      await models().Address.destroy({ where: {} })
      const a = await models().Address.create({
        user_id: user.id, contact_name: 'A', contact_phone: '13800138000',
        detail_address: 'A', full_address: 'A', is_default: true
      })
      const b = await models().Address.create({
        user_id: user.id, contact_name: 'B', contact_phone: '13800138000',
        detail_address: 'B', full_address: 'B', is_default: false
      })
      await Promise.all([
        request(app).put(`/api/addresses/${a.id}/default`).set('Authorization', `Bearer ${token}`),
        request(app).put(`/api/addresses/${b.id}/default`).set('Authorization', `Bearer ${token}`)
      ])
      const rows = await models().Address.findAll({ where: { user_id: user.id } })
      const n = rows.filter(x => x.is_default).length
      if (n === 2) twoDefaults.push(round)
      else if (n === 0) zeroDefaults.push(round)
    }
    expect(
      { twoDefaults, zeroDefaults },
      `并发设默认出现了异常：两个默认 ${twoDefaults.length} 轮、没有默认 ${zeroDefaults.length} 轮`
    ).toEqual({ twoDefaults: [], zeroDefaults: [] })
  }, 120000)

  it('AD-4 串行操作不受影响', async () => {
    const res = await request(app).put(`/api/addresses/${addrB.id}/default`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const rows = await models().Address.findAll({ where: { user_id: user.id } })
    const defs = rows.filter(r => r.is_default)
    expect(defs.length).toBe(1)
    expect(defs[0].id).toBe(addrB.id)
    expect((await models().Address.findByPk(addrA.id)).is_default).toBe(false)
  })
})
