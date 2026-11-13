/**
 * 体检项的**元测试**：每一条检查都必须能证明自己会响
 *
 * ## 为什么要有这个
 *
 * 一条"永远绿"的检查比没有检查更危险：
 *   - 它给人虚假的安全感（"25 项体检全绿！"）
 *   - 真正出问题那天，它不会报警
 *   - 更糟：它如果**误报**（把合法数据判成违规），真问题会被淹没
 *
 * 实际踩过的坑：最初加的引用完整性检查里，大部分是
 * `LEFT JOIN ... WHERE 外键 IS NULL` —— 而那些外键是 NO ACTION，
 * 删父行会被数据库直接拒绝 → **孤儿行根本产生不出来** → 永远绿。
 *
 * ## 现在的规则
 *
 * 每条检查**必须**二选一：
 *
 *   1. 有 `selfTest` —— 能造出违规数据（绕过应用层直接写库），
 *      元测试会**实际跑一遍**，确认这条检查真的抓到了。
 *      抓不到 → 测试失败（说明它是假检查）。
 *
 *   2. 标 `defensive: true` + `defensiveReason` —— 明确写出
 *      "它由哪个数据库约束保证，应用层造不出这种数据"。
 *      没有理由 → 测试失败。
 *
 * 两者都没有 → 测试失败。这样**新增一条永远绿的检查会被当场拦下**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryTypes } from 'sequelize'
import { TestDatabase } from '../setup/test-database.js'
import { CHECKS } from '@server/utils/dataInvariants.js'

const sequelize = () => TestDatabase.getSequelize()
const models = () => sequelize().models

describe('体检项的元测试', () => {
  beforeEach(async () => {
    await TestDatabase.clearAllData()
  })

  afterEach(async () => {
    await TestDatabase.clearAllData()
  })

  it('IM-1 检查项名称不重复', () => {
    const names = CHECKS.map(c => c.name)
    const dup = names.filter((n, i) => names.indexOf(n) !== i)
    expect(dup, `重复的检查项：${dup.join(', ')}`).toEqual([])
  })

  it('IM-2 每条检查要么能自证会响，要么显式声明由什么保证', () => {
    const missing = CHECKS.filter(c => !c.selfTest && !c.defensive).map(c => c.name)
    expect(
      missing,
      '这些检查既没有 selfTest（无法证明会响）也没标 defensive：\n' +
      '  → 要么补一个能造出违规数据的 selfTest，要么写明它由哪个数据库约束保证'
    ).toEqual([])
  })

  it('IM-3 每条 defensive 检查都写明了理由', () => {
    const bad = CHECKS
      .filter(c => c.defensive)
      .filter(c => !c.defensiveReason || String(c.defensiveReason).trim().length < 10)
      .map(c => c.name)
    expect(bad, '防御项必须写明"由什么保证"（如某个 NO ACTION 外键）').toEqual([])
  })

  it('IM-4 每条 selfTest 造的违规数据，真的能被本项检查抓到', async () => {
    const failures = []
    for (const check of CHECKS) {
      if (!check.selfTest) continue
      await TestDatabase.clearAllData()
      try {
        await check.selfTest(models())
      } catch (e) {
        failures.push(`${check.name}：selfTest 自己抛错了 → ${e.message}`)
        continue
      }
      let rows = []
      try {
        rows = await sequelize().query(check.sql, {
          type: QueryTypes.SELECT,
          replacements: { days: '30' }
        })
      } catch (e) {
        failures.push(`${check.name}：检查 SQL 执行失败 → ${e.message}`)
        continue
      }
      if (!rows.length) {
        failures.push(`${check.name}：❌ 造了违规数据却抓不到 —— 这是"永远绿的假检查"`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('IM-5 清理干净时，所有检查都不该报（没数据 → 没违规）', async () => {
    const noisy = []
    for (const check of CHECKS) {
      const rows = await sequelize().query(check.sql, {
        type: QueryTypes.SELECT,
        replacements: { days: '30' }
      })
      if (rows.length) noisy.push(`${check.name}（空库就报了 ${rows.length} 行）`)
    }
    expect(noisy, '空库时不该有检查报错（说明 SQL 写错了，比如恒真条件）：\n' + noisy.join('\n')).toEqual([])
  })
})
