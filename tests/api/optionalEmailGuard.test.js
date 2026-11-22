/**
 * 选填邮箱的空值护栏（第 50 轮）
 * ===========================
 *
 * ## 这个 bug 是怎么被发现的
 *
 * 第 50 轮写「后台业务流」E2E（建操作员）时，UI 上明确标着"选填"的邮箱，
 * **不填就建不了人**：后端返回 400「「email」格式不正确（应为邮箱地址）」。
 *
 * 根因：Sequelize 的 `isEmail` 校验只跳过 `null`/`undefined`，
 * 而前端表单不填时提交的是**空字符串 `''`** → 空字符串被判定成"不是合法邮箱"。
 *
 * 表面看是个 400，实际上有两个后果：
 *   1. **提示指向错误的字段** —— 运营什么都没填错，却被告知邮箱格式不对
 *   2. **唯一键会炸** —— `email` 上有 unique 约束，
 *      即使放宽校验让 `''` 存进去，第二个不填邮箱的操作员就会撞唯一键
 *
 * ## 护栏
 *
 *   EG-1 邮箱留空（''）能建成，存进库的是 null
 *   EG-2 **两个**都不填邮箱的操作员都能建成（不撞唯一键）
 *   EG-3 填了合法邮箱 → 正常存
 *   EG-4 填了非法邮箱 → 仍然被拒（不能因为放宽就把垃圾数据放进来）
 *   EG-5 用户侧同一口径（'' 与 null 等价）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

describe('选填邮箱的空值护栏', () => {
  let adminToken

  // 用例之间要清库（邮箱唯一键会互相干扰），所以每个用例都重新建管理员
  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
    adminToken = TestHelpers.generateAdminToken(admin)
  })

  it('EG-1 邮箱留空（空字符串）能建成操作员，存进库的是 null', async () => {
    const username = 'op_blank_email'
    const res = await request(app)
      .post('/api/admin/administrators')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username, password: 'Journey#2026', role: 'operator', email: '' })

    expect(res.status).toBe(201)
    const row = await models().Administrator.findOne({ where: { username } })
    expect(row, '操作员没有真的建出来').toBeTruthy()
    // 关键：存的是 null 而不是 ''（否则会占唯一键）
    expect(row.email, '空邮箱应归一化为 null').toBeNull()
  })

  it('EG-2 两个都不填邮箱的操作员都能建成（不撞唯一键）', async () => {
    const names = ['op_blank_1', 'op_blank_2']
    for (const username of names) {
      const res = await request(app)
        .post('/api/admin/administrators')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username, password: 'Journey#2026', role: 'operator', email: '' })
      expect(res.status, `${username} 建不出来`).toBe(201)
    }
    const rows = await models().Administrator.findAll({ where: { username: names } })
    expect(rows.length).toBe(2)
    for (const r of rows) expect(r.email).toBeNull()
  })

  it('EG-3 填了合法邮箱 → 正常存下来', async () => {
    const username = 'op_with_email'
    const res = await request(app)
      .post('/api/admin/administrators')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username, password: 'Journey#2026', role: 'operator', email: 'op@example.com' })

    expect(res.status).toBe(201)
    const row = await models().Administrator.findOne({ where: { username } })
    expect(row.email).toBe('op@example.com')
  })

  it('EG-4 填了非法邮箱 → 仍然被拒（不能因为放宽就把垃圾数据放进来）', async () => {
    const res = await request(app)
      .post('/api/admin/administrators')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'op_bad_email', password: 'Journey#2026', role: 'operator', email: 'not-an-email' })

    expect(res.status).toBe(400)
    const row = await models().Administrator.findOne({ where: { username: 'op_bad_email' } })
    expect(row, '非法邮箱不该建出账号').toBeNull()
  })

  it('EG-5 用户侧同一口径：空邮箱与 null 等价', async () => {
    const phone = '812340099'
    const res = await request(app)
      .post('/api/users/register')
      .send({ nickname: '空邮箱客户', phone, country_code: '+66', password: 'Journey#2026', email: '' })

    expect(res.status).toBe(201)
    const row = await models().User.findOne({ where: { phone } })
    expect(row, '用户没有真的注册出来').toBeTruthy()
    expect(row.email, '空邮箱应归一化为 null').toBeNull()
  })
})
