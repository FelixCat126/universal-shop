/**
 * 管理员「强制改密」机制
 *
 * ## 背景（第 33 轮安全彻查实测）
 *
 * 对**生产库**做了只读比对（不修改任何数据）：
 *   管理员 admin → 密码是否为默认 123456：❌ 是
 *   合作方 test/test1 → 同为 123456
 *
 * 用户端与合作方端早就有 `must_reset_password` 字段 + 前端强制改密流程，
 * **管理员端却完全没有**：没有字段、没有"改自己密码"的接口、没有强制拦截。
 * 只有一句 i18n 文案"首次登录后请立即修改密码"，从来没被实现过。
 *
 * ## 用例
 *   AR-1 迁移后 administrators 表有 must_reset_password 字段
 *   AR-2 被标记的管理员：除改密/登出外，所有后台接口都 403（PASSWORD_CHANGE_REQUIRED）
 *   AR-3 改密接口本身可达（否则管理员会被锁在门外）
 *   AR-4 原密码错误 → 400，且标志**不被清除**
 *   AR-5 新密码不满足强度 → 400
 *   AR-6 改密成功 → 标志清除、旧令牌失效（token_version 递增）、可正常访问后台
 *   AR-7 未被标记的管理员**不受影响**（不能误伤正常账号）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let admin
let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  admin = await TestHelpers.createAdminUser({ role: 'super_admin' })
  token = TestHelpers.generateAdminToken(admin)
})

describe('管理员强制改密', () => {
  it('AR-1 administrators 表有 must_reset_password 字段', async () => {
    const res = await TestDatabase.getSequelize().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'administrators'
          AND column_name = 'must_reset_password'`
    )
    const rows = Array.isArray(res?.[0]) ? res[0] : (res || [])
    expect(rows.length, '迁移 015 之后应有 must_reset_password 列').toBeGreaterThan(0)
  })

  it('AR-2 被标记后：后台接口一律 403（PASSWORD_CHANGE_REQUIRED）', async () => {
    await models().Administrator.update({ must_reset_password: true }, { where: { id: admin.id } })

    for (const url of ['/api/admin/orders', '/api/admin/partners', '/api/admin/product-categories']) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${token}`)
      expect(res.status, `${url} 应被强制改密拦截`).toBe(403)
      expect(res.body?.code).toBe('PASSWORD_CHANGE_REQUIRED')
    }
  })

  it('AR-3 改密接口与"取自己信息"在强制改密期间仍可达', async () => {
    await models().Administrator.update({ must_reset_password: true }, { where: { id: admin.id } })

    const me = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${token}`)
    expect(me.status, '/api/admin/me 必须放行（否则前端连改密页都拿不到信息）').toBe(200)
    expect(me.body?.data?.must_reset_password).toBe(true)

    const wrong = await request(app).put('/api/admin/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'x', new_password: 'Abcd1234' })
    expect(wrong.status, '改密接口本身必须可达').not.toBe(403)
  })

  it('AR-4 原密码错误 → 400，标志不被清除', async () => {
    await models().Administrator.update({ must_reset_password: true }, { where: { id: admin.id } })
    const res = await request(app).put('/api/admin/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'WrongPass1234', new_password: 'NewPass2026' })

    expect(res.status).toBe(400)
    const after = await models().Administrator.findByPk(admin.id)
    expect(after.must_reset_password, '改密失败不能清除标志').toBe(true)
  })

  it('AR-5 新密码不满足强度 → 400', async () => {
    const res = await request(app).put('/api/admin/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ old_password: 'Abcd1234', new_password: 'abc' })
    expect(res.status).toBe(400)
  })

  it('AR-6 改密成功 → 标志清除 + 旧令牌失效 + 可正常访问', async () => {
    await models().Administrator.update({ must_reset_password: true }, { where: { id: admin.id } })
    const oldToken = token

    const res = await request(app).put('/api/admin/me/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ old_password: 'Abcd1234', new_password: 'NewPass2026' })
    expect(res.status, res.body?.message).toBe(200)

    const after = await models().Administrator.findByPk(admin.id)
    expect(after.must_reset_password, '改密成功后应清除标志').toBe(false)
    expect(Number(after.token_version), '应递增 token_version').toBeGreaterThan(0)

    // 旧令牌应立即失效（凭据变更即刻收敛）
    const stale = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${oldToken}`)
    expect(stale.status, '旧令牌应失效').toBe(401)

    // 用新密码重新登录 → 可以正常用后台
    const login = await request(app).post('/api/admin/login')
      .send({ username: admin.username, password: 'NewPass2026' })
    expect(login.status).toBe(200)
    expect(login.body?.data?.must_reset_password).toBe(false)
    const newToken = login.body.data.token
    const ok = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${newToken}`)
    expect(ok.status).toBe(200)
  })

  it('AR-7 未被标记的管理员不受影响', async () => {
    const res = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})
