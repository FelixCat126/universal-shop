/**
 * 密码策略的**跨 realm 一致性**护栏
 *
 * ## 为什么要有这个
 *
 * 用户侧、用户改密、密码重置、合作方自助改密、合作方管理端创建/重置
 * —— 全部走 `assertPasswordPolicy`（≥8 位 + 数字 + 字母）。
 *
 * 但**管理端**的两个入口曾经是例外：
 *   - POST /api/admin/administrators            → 根本不校验强度
 *   - PUT  /api/admin/administrators/:id/reset-password → 只校验"≥6 个字符"
 *
 * 管理端是权限最高的 realm：令牌能看全部订单、客户资料、导出与经营统计。
 * 策略比别处松 = 全站最弱的一环恰好在最值钱的地方。
 *
 * ## 判定方式
 *
 * 纯**黑盒行为**断言（不看实现），所以将来谁改了实现方式都不会误报：
 * 弱口令必须被 400 拦下，强口令必须真的能用（不只是"没报错"）。
 *
 *   PP-1 管理端创建管理员：弱口令被拒
 *   PP-2 管理端重置管理员密码：弱口令被拒
 *   PP-3 管理端创建/重置：强口令真的能登录（防"一刀切拒一切"）
 *   PP-4 合作方管理端：弱口令同样被拒（同一把尺子的另一半）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

/** 弱口令清单：每一种都违反统一策略的某一条 */
const WEAK = [
  { pwd: '123456', why: '少于8位' },
  { pwd: '12345678', why: '没有英文字母' },
  { pwd: 'abcdefgh', why: '没有数字' },
  { pwd: 'abc', why: '过短' }
]

const STRONG = 'Admin#2026x'

describe('密码策略跨 realm 一致性', () => {
  it('PP-1 管理端创建管理员：弱口令一律被拒', async () => {
    const { token } = await adminCtx()
    for (const { pwd, why } of WEAK) {
      const res = await request(app).post('/api/admin/administrators')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: `weak_${pwd}`, password: pwd, role: 'operator' })
      expect(res.status, `弱口令「${pwd}」（${why}）不该被接受`).toBe(400)
    }
  })

  it('PP-2 管理端重置管理员密码：弱口令一律被拒', async () => {
    const { token } = await adminCtx()
    const target = await TestHelpers.createAdminUser({ role: 'operator' })
    for (const { pwd, why } of WEAK) {
      const res = await request(app).put(`/api/admin/administrators/${target.id}/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: pwd })
      expect(res.status, `弱口令「${pwd}」（${why}）不该被接受`).toBe(400)
    }
  })

  it('PP-3 管理端设的强口令真的能登录（不是"一律拒绝"）', async () => {
    const { token } = await adminCtx()
    const created = await request(app).post('/api/admin/administrators')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'strong_op', password: STRONG, role: 'operator' })
    expect([200, 201]).toContain(created.status)

    // 新账号必须真的能用这个口令登录
    const login = await request(app).post('/api/admin/login')
      .send({ username: 'strong_op', password: STRONG })
    expect(login.status, '强口令创建的管理员应该能登录').toBe(200)

    // 重置路径同样要"真的生效"
    const target = await TestHelpers.createAdminUser({ role: 'operator' })
    const reset = await request(app).put(`/api/admin/administrators/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Reset#2026a' })
    expect(reset.status).toBe(200)

    const relogin = await request(app).post('/api/admin/login')
      .send({ username: target.username, password: 'Reset#2026a' })
    expect(relogin.status, '重置后的口令应该能登录').toBe(200)
  })

  it('PP-4 合作方管理端：弱口令同样被拒（同一把尺子）', async () => {
    const { token } = await adminCtx()
    for (const { pwd, why } of WEAK) {
      const res = await request(app).post('/api/admin/partners')
        .set('Authorization', `Bearer ${token}`)
        .send({ login: `weak_p_${pwd}`, password: pwd, display_name: '弱口令合作方' })
      expect(res.status, `弱口令「${pwd}」（${why}）不该被接受`).toBe(400)
    }
  })
})
