/**
 * 密码策略的**前后端一致性**元测试
 *
 * ## 为什么要有这个
 *
 * "所有设密入口同一把尺子"这句话，只有在**后端与前端真的用同一套规则**时才成立。
 * 现实是：
 *   - 门户自带一份正则副本（`src/portal/utils/passwordPolicy.js`）
 *   - 合作方改密页又抄了一份
 *   - 管理端写死 `{ min: 6 }` —— 比后端还松
 *
 * 后端一收紧，前端就会变成"前端校验过了、后端返回 400"的错位，
 * 用户完全不知道错在哪（这正是 AT-7 之前管理端的状态）。
 *
 * ## 判定方式
 *
 * **行为比对**，不是源码 diff：把同一批口令分别喂给后端 `assertPasswordPolicy`
 * 与前端 `describePasswordPolicyFailure`，结论必须一致。
 * 这样将来实现怎么改都不会误报。
 *
 *   PP-1 同一批口令，前后端判定结论完全一致
 *   PP-2 前端共享层是唯一的规则实现（没有第二份副本）
 *   PP-3 门户/合作方/管理端都从共享层取规则
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { assertPasswordPolicy } from '@server/utils/passwordPolicy.js'
import {
  describePasswordPolicyFailure,
  PASSWORD_MIN_LEN
} from '../../src/utils/passwordPolicy.js'

const ROOT = path.resolve(__dirname, '../..')

/** 覆盖各种边界的口令样本 */
const SAMPLES = [
  '',                 // 空
  'a',                // 太短
  '12345678',         // 8 位但无字母
  'abcdefgh',         // 8 位但无数字
  '1234567',          // 差一位
  'abcdefg1',         // 刚好合格
  'Abcd1234',         // 合格
  'Admin#2026x',      // 合格（含符号）
  'P@ssw0rd!',        // 合格
  '123456789012345',  // 长但无字母
  'ABCDEFGHIJKLMNO',  // 长但无数字
  '中文密码12345678',  // 含非 ASCII
  '  Abcd1234  '      // 带空格
]

describe('密码策略：前后端同一把尺子', () => {
  it('PP-1 同一批口令，前后端判定结论完全一致', () => {
    const mismatches = []
    for (const pwd of SAMPLES) {
      const backendOk = assertPasswordPolicy(pwd).ok
      const frontendFail = describePasswordPolicyFailure(pwd)
      // 空串：后端返回"请输入密码"（ok=false）；前端 describePasswordPolicyFailure
      // 对空串返回 null，交给调用方提示"必填" —— 两端都拦，结论都是"不通过"。
      const frontendOk = frontendFail === null && pwd !== ''
      if (backendOk !== frontendOk) {
        mismatches.push(
          `「${pwd}」后端=${backendOk ? '通过' : '拒绝'}，前端=${frontendOk ? '通过' : '拒绝'}`
        )
      }
    }
    expect(mismatches, '前后端密码策略不一致：\n' + mismatches.join('\n')).toEqual([])
  })

  it('PP-2 前端共享层是唯一的规则实现（没有第二份副本）', () => {
    const shared = path.join(ROOT, 'src/utils/passwordPolicy.js')
    const portal = path.join(ROOT, 'src/portal/utils/passwordPolicy.js')
    const partner = path.join(ROOT, 'src/partner/views/Password.vue')
    const admin = path.join(ROOT, 'src/admin/views/Operators.vue')

    // 共享层必须真的定义规则
    const sharedSrc = fs.readFileSync(shared, 'utf8')
    expect(sharedSrc, '共享层应该定义最小长度').toMatch(/PASSWORD_MIN_LEN\s*=\s*\d+/)
    expect(sharedSrc, '共享层应该校验数字').toMatch(/\[0-9\]/)
    expect(sharedSrc, '共享层应该校验字母').toMatch(/\[A-Za-z\]/)

    // 门户那份只做转发，不再自己抄规则
    const portalSrc = fs.readFileSync(portal, 'utf8')
    expect(portalSrc, '门户应该转发到共享层').toMatch(/from\s+'\.\.\/\.\.\/utils\/passwordPolicy\.js'/)
    expect(portalSrc, '门户不该再自己写规则').not.toMatch(/\[0-9\]\s*\.test/)

    // 合作方与管理端都从共享层取
    expect(fs.readFileSync(partner, 'utf8'), '合作方改密页应该从共享层取规则')
      .toMatch(/from\s+'\.\.\/\.\.\/utils\/passwordPolicy\.js'/)
    expect(fs.readFileSync(admin, 'utf8'), '管理端应该从共享层取规则')
      .toMatch(/from\s+'\.\.\/\.\.\/utils\/passwordPolicy\.js'/)
  })

  it('PP-3 前后端的最小长度一致', () => {
    const backendSrc = fs.readFileSync(path.join(ROOT, 'src/server/utils/passwordPolicy.js'), 'utf8')
    const m = /s\.length\s*<\s*(\d+)/.exec(backendSrc)
    expect(m, '后端策略里应该能看到最小长度').not.toBeNull()
    expect(Number(m[1]), '前后端最小长度必须一致').toBe(PASSWORD_MIN_LEN)
  })
})
