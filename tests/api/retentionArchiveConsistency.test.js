/**
 * 留存清理归档积分流水后的**账实一致**
 *
 * ## 背景
 *
 * 余额是用户资产，流水是为了控表体积才清。清完必须把**被删流水的净额**
 * 记到余额行的 archived_delta，否则：
 *   「余额 = 剩余流水累计 + archived_delta」不成立 → 每日体检**永久报红**
 *   （用户看着"账不平"，其实是清理脚本的锅）；而且该用户的老订单取消时
 *   earn_purchase 流水已没了 → earned=0 → 已发的积分收不回来（白拿）。
 *
 * ## 发现的隐患
 *
 * 原来是"先算净额 → 再记账 → 再删"三条**独立语句**（各自一个事务）。
 * READ COMMITTED 下每条语句取自己的快照：汇总之后、删除之前若有**并发写入积分**，
 * 那条新流水会被删掉，但归档净额里没有它 → 恒等式被破坏。
 *
 * 现在：一批的「锁余额行 → 汇总 → 记账 → 删除」在**同一个事务**里，
 * 且先锁住受影响用户的余额行（与 pointsService 同一把 FOR UPDATE 锁）
 * → 并发写积分排队等待 → 汇总看到的集合 = 实际删掉的集合。
 *
 *   RA-1 清理后恒等式仍成立（余额 = 剩余流水 + 已归档净额）
 *   RA-2 归档净额 = 被删流水的净额（不多不少）
 *   RA-3 并发写入积分时，恒等式**仍然**成立（锁挡住了并发）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { cleanupRetentionData } from '@server/services/retentionService.js'
import sequelize from '@server/config/database.js'
import UserPointBalance from '@server/models/UserPointBalance.js'

const models = () => TestDatabase.getSequelize().models

let user

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { User } = models()
  user = await User.create({
    username: 'ra_' + Date.now(), nickname: '归档用户', country_code: '+86',
    phone: '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
    password: 'Abcd1234', is_active: true
  })
})

/** 建一笔积分流水 */
async function tx (delta, daysAgo) {
  const { PointTransaction } = models()
  const created = new Date(Date.now() - daysAgo * 86400000)
  return PointTransaction.create({
    user_id: user.id, type: 'earn_other', delta,
    balance_after: delta, description: '测试流水',
    created_at: created, updated_at: created
  })
}

/** 校验恒等式 */
async function expectIdentityHolds () {
  const { UserPointBalance, PointTransaction } = models()
  const bal = await UserPointBalance.findOne({ where: { user_id: user.id }, raw: true })
  const txs = await PointTransaction.findAll({ where: { user_id: user.id } })
  const ledger = txs.reduce((s, t) => s + Number(t.delta || 0), 0)
  const archived = Number(bal?.archived_delta || 0)
  expect(Number(bal?.balance || 0), `余额=${bal?.balance} 剩余流水=${ledger} 已归档=${archived}`).toBe(ledger + archived)
}

describe('留存清理的归档一致性', () => {
  it('RA-1 清理后恒等式仍成立', async () => {
    await tx(100, 800)
    await tx(-30, 790)
    await models().UserPointBalance.create({ user_id: user.id, balance: 70, after_balance: 70 })

    const res = await cleanupRetentionData({ pointDays: 730 })
    expect(res.pointDeleted).toBeGreaterThan(0)

    await expectIdentityHolds()
  })

  it('RA-2 归档净额 = 被删流水的净额', async () => {
    await tx(100, 800)
    await tx(-30, 790)
    await models().UserPointBalance.create({ user_id: user.id, balance: 70, after_balance: 70 })

    await cleanupRetentionData({ pointDays: 730 })

    const { UserPointBalance } = models()
    const bal = await UserPointBalance.findOne({ where: { user_id: user.id }, raw: true })
    // 被删的净额 = 100 - 30 = 70
    expect(Number(bal?.archived_delta || 0)).toBe(70)
    expect(Number(bal?.balance || 0), '余额是用户资产，一分不能少').toBe(70)
  })

  it('RA-4 清理在**汇总之前**就锁住余额行', async () => {
    // 热身：先把连接池烧热（冷启动耗时会被误读成"在等锁"）。
    await cleanupRetentionData({ pointDays: 730 })

    // 造数据**要在热身之后** —— 热身那轮已经把老流水删了。
    await tx(100, 800)
    await models().UserPointBalance.create({ user_id: user.id, balance: 100, after_balance: 100 })

    // 用 FOR NO KEY UPDATE 锁住余额行。两种实现都会卡在这里，
    // 但**卡在哪一句**不同 —— 那才是要守的不变量：
    //   修好后：卡在「先锁余额行」的 SELECT ... FOR UPDATE（汇总之前）✅
    //   没修的话：卡在「汇总完之后记账」的 UPDATE user_point_balances ❌
    const blocker = await sequelize.transaction()
    await UserPointBalance.findOne({
      where: { user_id: user.id },
      transaction: blocker,
      lock: blocker.LOCK.NO_KEY_UPDATE
    })

    const pending = cleanupRetentionData({ pointDays: 730 }).then(r => ({ done: true, r }))
    await new Promise(res => setTimeout(res, 800))

    const { QueryTypes } = await import('sequelize')
    const waiting = await sequelize.query(
      `SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'active'
          AND wait_event_type = 'Lock' LIMIT 1`,
      { type: QueryTypes.SELECT }
    )
    const waitingSql = String(waiting[0]?.query || '')
    await blocker.rollback().catch(() => {})
    await pending.catch(() => {})

    expect(
      waitingSql,
      '清理应该先锁住余额行（SELECT ... FOR UPDATE）再汇总；' +
        '若卡在 UPDATE user_point_balances，说明是汇总完之后才锁 —— ' +
        '并发写积分就会插在汇总与删除之间，归档净额与实际删除对不上'
    ).toMatch(/^\s*SELECT/i)
  }, 30000)
  it('RA-3 并发写入积分时，恒等式仍然成立', async () => {
    await tx(100, 800)
    await models().UserPointBalance.create({ user_id: user.id, balance: 100, after_balance: 100 })

    // 清理的同时，另一笔积分写入（模拟用户下单得积分）
    const [cleanup] = await Promise.all([
      cleanupRetentionData({ pointDays: 730 }),
      (async () => {
        await new Promise(r => setTimeout(r, 5))
        // 模拟真实写积分：**流水 + 余额** 一起写（pointsService 就是这么做的）
        await tx(50, 0)
        await models().UserPointBalance.update(
          { balance: 150, after_balance: 150 },
          { where: { user_id: user.id } }
        )
      })()
    ])
    expect(cleanup.pointDeleted).toBeGreaterThan(0)

    await expectIdentityHolds()
  })
})
