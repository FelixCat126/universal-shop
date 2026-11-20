/**
 * CSV 导入的原子性与初始密码（第 45 轮）
 * ======================================
 *
 * ## 两个问题
 *
 * **（1）写入阶段没有事务** —— 逐行独立写库。中途失败/进程被杀 →
 * **半截数据留在库里**（导入 100 个客户，第 60 个报错 → 前 59 个已经建好了）。
 * 而 strict 模式号称"整批不落库"，实际做不到。
 *
 * 修法：写入阶段整体在一个事务里，每行一个**保存点**
 * （行内报错只回滚那一行，不会让整个事务 aborted）；
 * strict 模式下只要有失败行 → 整批回滚。
 *
 * **（2）初始密码被前端丢弃** —— 后端把初始密码放在导入结果的 `created[]` 里
 * （"初始密码只在这里出现一次，运营要线下告知用户"），
 * 前端却只把结果用来刷新列表 → **运营拿不到密码** → 导入的账号谁也登不进去。
 *
 * 修法：导入对话框在成功后弹"初始密码"列表（可一键复制）。
 *
 * ## 用例
 *   CI-1 strict 模式：写入阶段有失败行 → **整批不落库**
 *   CI-2 skip 模式：同样的数据 → 成功的行落库、失败的行回报
 *   CI-3 导入结果里带**初始密码**（前端才有东西可展示）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

const USER_CSV_HEADER = 'id,nickname,username,email,phone,country_code,referral_code,is_active'

let adminToken

function attachUserCsv (content, { mode } = {}) {
  let req = request(app)
    .post('/api/admin/users/import')
    .set('Authorization', `Bearer ${adminToken}`)
    .field('dry_run', 'false')
  if (mode !== undefined) req = req.field('mode', mode)
  return req.attach('file', Buffer.from('﻿' + content, 'utf8'), {
    filename: 'users.csv',
    contentType: 'text/csv'
  })
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `csvtx_admin_${Date.now()}`,
    password: 'CsvPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

describe('CSV 导入的原子性', () => {
  it('CI-1 strict 模式：写入阶段有失败行 → 整批不落库', async () => {
    const { User } = models()
    const before = await User.count()

    /**
     * **写入阶段**才失败的场景：两行的 username 相同。
     *
     * 预览只校验「字段格式 + 库内重复」**以及文件内的手机号重复**，
     * 但**不校验文件内的 username 重复** → 预览放行 →
     * 真正 INSERT 时第二行撞 username 唯一索引 → 写入阶段失败。
     *
     * ⚠️ 不能用"id 指向不存在的用户"来触发：那个是**预览**就会拦的
     * （id 对应的用户不存在 → invalid 行 → strict 模式整批拒绝），
     * 那样根本走不到写入阶段，测的就不是"写入阶段失败后的原子性"了。
     */
    const csv = [
      USER_CSV_HEADER,
      ',甲用户,dupe_user,,812345001,+66,,1',
      ',乙用户,dupe_user,,812345002,+66,,1'
    ].join('\n')

    const res = await attachUserCsv(csv, { mode: 'strict' })
    expect(res.status, `strict 模式应当报错：${JSON.stringify(res.body)}`).toBe(400)

    const after = await User.count()
    expect(after, 'strict 模式失败时整批都不该落库（之前会留下半截数据）').toBe(before)
  })

  it('CI-2 skip 模式：成功的行落库、失败的行回报', async () => {
    const { User } = models()
    const before = await User.count()

    const csv = [
      USER_CSV_HEADER,
      ',甲用户,ok_user1,,812345001,+66,,1',
      ',乙用户,ok_user2,,812345002,+66,,1'
    ].join('\n')

    const res = await attachUserCsv(csv, { mode: 'skip' })
    expect(res.status).toBe(200)
    expect(res.body.data.createdCount).toBe(2)
    expect(await User.count()).toBe(before + 2)
  })

  it('CI-3 导入结果里带初始密码（前端才有东西可展示给运营）', async () => {
    const csv = [
      USER_CSV_HEADER,
      ',甲用户,pwd_user1,,812345001,+66,,1'
    ].join('\n')

    const res = await attachUserCsv(csv, { mode: 'skip' })
    expect(res.status).toBe(200)
    const created = res.body.data.created || []
    expect(created.length).toBe(1)
    expect(created[0].initialPassword, '导入结果必须带初始密码（只出现这一次）').toBeTruthy()
    expect(typeof created[0].initialPassword).toBe('string')
  })

  it('CI-4 导入的账号带 must_reset_password（首次登录强制改密）', async () => {
    const csv = [
      USER_CSV_HEADER,
      ',甲用户,reset_user1,,812345001,+66,,1'
    ].join('\n')

    const res = await attachUserCsv(csv, { mode: 'skip' })
    expect(res.status).toBe(200)

    const { User } = models()
    const row = await User.findOne({ where: { username: 'reset_user1' }, raw: true })
    expect(row, '导入的账号应当落库').toBeTruthy()
    expect(row.must_reset_password, '导入的账号首次登录必须改密').toBe(true)
  })
})
