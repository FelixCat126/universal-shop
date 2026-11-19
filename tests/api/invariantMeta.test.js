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
import { spawnSync } from 'node:child_process'
import path from 'node:path'
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

  it('IM-1b 没有语义重复的检查（同一件事写了两遍）', () => {
    /**
     * IM-1 只查**名称**不重复 —— 查不出"同一件事写了两遍"。
     *
     * 实际踩过：`coupon_template_exists` 与 `user_coupon_template_exists`
     * 查的是同一张表同一列（user_coupons.template_id），
     * 名字不同所以 IM-1 放行，体检报告里同一件事报了两遍 ——
     * **虚增了"覆盖度"的错觉**，让人以为检查项更多更全。
     *
     * 判定：把 SQL 归一化（去空白、去大小写差异）后比对。
     */
    /**
     * 归一化只取「检查对象」：FROM 之后的 JOIN / WHERE 部分。
     *
     * 为什么不能比整条 SQL：两条语义相同的检查，投影列可能写得不一样
     * （`uc.template_id` vs `uc.template_id AS template_id`）——
     * 那是写法差异，不是检查内容差异。
     * 而 FROM/JOIN/WHERE 才是"这条检查到底在查什么"。
     */
    const normalize = (sql) => {
      const flat = String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const i = flat.indexOf(' from ')
      return (i === -1 ? flat : flat.slice(i)).replace(/\s*([(),=<>])\s*/g, '$1')
    }

    const seen = new Map()
    const dups = []
    for (const check of CHECKS) {
      const key = normalize(check.sql)
      if (seen.has(key)) {
        dups.push(`「${check.name}」与「${seen.get(key)}」查的是同一件事`)
      } else {
        seen.set(key, check.name)
      }
    }
    expect(dups, '语义重复的检查项（同一件事写了两遍）：\n' + dups.join('\n')).toEqual([])
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
        if (check.custom) {
          // custom 检查项（如 bcrypt 比对默认口令）没有 SQL，直接调它
          const { setInvariantSequelizeRef } = await import('../../src/server/utils/dataInvariants.js')
          setInvariantSequelizeRef({ models: models() })
          rows = (await check.custom()) || []
        } else {
          rows = await sequelize().query(check.sql, {
            type: QueryTypes.SELECT,
            replacements: { days: '30' }
          })
        }
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
      let rows = []
      if (check.custom) {
        const { setInvariantSequelizeRef } = await import('../../src/server/utils/dataInvariants.js')
        setInvariantSequelizeRef({ models: models() })
        rows = (await check.custom()) || []
      } else {
        rows = await sequelize().query(check.sql, {
          type: QueryTypes.SELECT,
          replacements: { days: '30' }
        })
      }
      if (rows.length) noisy.push(`${check.name}（空库就报了 ${rows.length} 行）`)
    }
    expect(noisy, '空库时不该有检查报错（说明 SQL 写错了，比如恒真条件）：\n' + noisy.join('\n')).toEqual([])
  })

  it('IM-6 自证模式在生产环境必须被硬拦（它会 TRUNCATE 表）', async () => {
    // 自证模式会清空表并写入违规数据。如果它在生产环境跑得起来，
    // 一次手滑就是全站数据归零 —— 所以这条闸本身也要有护栏。
    const script = path.resolve(__dirname, '../../scripts/check-data-invariants.mjs')
    const res = spawnSync(process.execPath, [script, '--self-test', '--allow-production'], {
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 30000
    })

    expect(res.status, '生产环境下自证模式必须以非 0 退出码拒绝执行').not.toBe(0)
    const out = `${res.stdout || ''}${res.stderr || ''}`
    expect(out, '拒绝时必须说明原因和正确的跑法').toMatch(/生产|清空|TRUNCATE/i)
  }, 60000)
})
