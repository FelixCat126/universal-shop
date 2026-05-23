/**
 * P4 — Admin 权限矩阵（参数化 8 用例）
 *   按 super_admin / admin / operator 三角色 × 4 关键端点：
 *     - GET  /api/admin/partners              → super_admin/admin 200, operator 403
 *     - GET  /api/admin/administrators        → super_admin/admin 200, operator 403
 *     - GET  /api/system-config               → 仅 super_admin 200，其余 403
 *     - GET  /api/admin/operation-logs        → 仅 super_admin 200，其余 403
 *
 *   统一断言：401（无 token） / 403（角色不足） / 200（足够）
 *   8 用例：
 *     PM-1 super_admin × partners → 200
 *     PM-2 admin       × partners → 200
 *     PM-3 operator    × partners → 403
 *     PM-4 super_admin × system-config → 200
 *     PM-5 admin       × system-config → 403
 *     PM-6 operator    × system-config → 403
 *     PM-7 admin       × administrators → 200
 *     PM-8 operator    × administrators → 403
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

beforeEach(async () => { await TestDatabase.clearAllData() })

async function tokenFor (role) {
  const admin = await TestHelpers.createAdminUser({ role })
  return TestHelpers.generateAdminToken(admin)
}

describe('P4.admin.permissions — partners', () => {
  it('PM-1 super_admin × GET /api/admin/partners → 200', async () => {
    const t = await tokenFor('super_admin')
    const res = await request(app).get('/api/admin/partners').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
  })

  it('PM-2 admin × GET /api/admin/partners → 200', async () => {
    const t = await tokenFor('admin')
    const res = await request(app).get('/api/admin/partners').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
  })

  it('PM-3 operator × GET /api/admin/partners → 403', async () => {
    const t = await tokenFor('operator')
    const res = await request(app).get('/api/admin/partners').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(403)
  })
})

describe('P4.admin.permissions — system-config', () => {
  it('PM-4 super_admin × GET /api/system-config → 200', async () => {
    const t = await tokenFor('super_admin')
    const res = await request(app).get('/api/system-config').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
  })

  it('PM-5 admin × GET /api/system-config → 403', async () => {
    const t = await tokenFor('admin')
    const res = await request(app).get('/api/system-config').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(403)
  })

  it('PM-6 operator × GET /api/system-config → 403', async () => {
    const t = await tokenFor('operator')
    const res = await request(app).get('/api/system-config').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(403)
  })
})

describe('P4.admin.permissions — administrators', () => {
  it('PM-7 admin × GET /api/admin/administrators → 200', async () => {
    const t = await tokenFor('admin')
    const res = await request(app).get('/api/admin/administrators').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
  })

  it('PM-8 operator × GET /api/admin/administrators → 403', async () => {
    const t = await tokenFor('operator')
    const res = await request(app).get('/api/admin/administrators').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(403)
  })
})
