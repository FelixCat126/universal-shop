/**
 * 操作员「改角色」闭环（第 45 轮）
 * ================================
 *
 * ## 原来是什么样
 *
 * 后端 `updateAdministrator` 一直支持 role / email / real_name / phone，
 * 但管理端的前端**只发 `is_active`**（启停）→ **角色改不了**。
 *
 * 后果：权限完全由角色决定（3 个固定角色），而角色又改不了 →
 * 想给同事加一点权限，只能**删号重建**（连用户名都得换），
 * 审计日志也断了（"谁在什么时候变成 admin 的"查不到）。
 *
 * ## 现在
 *
 * 操作员管理页新增「编辑」：角色 / 邮箱 / 姓名 / 手机，
 * 与后端既有能力对齐（后端的超管保护、鉴权缓存失效都继续生效）。
 *
 * ## 用例
 *   OR-1 超管把 operator 改成 admin → 200，角色真的变了
 *   OR-2 非超管不能把别人提成 super_admin → 403（后端保护不能被前端绕过）
 *   OR-3 改完角色后**鉴权缓存立即失效**（改完就按新权限走，不等 TTL）
 *   OR-4 前端有「编辑」入口（静态护栏：不能又退回"只能启停"）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const models = () => TestDatabase.getSequelize().models

beforeEach(async () => { await TestDatabase.clearAllData() })

async function adminCtx (role = 'super_admin') {
  const admin = await TestHelpers.createAdminUser({ role })
  return { admin, token: TestHelpers.generateAdminToken(admin) }
}

describe('操作员改角色', () => {
  it('OR-1 超管把 operator 改成 admin → 200，角色真的变了', async () => {
    const { token } = await adminCtx()
    const target = await TestHelpers.createAdminUser({ role: 'operator' })

    const res = await request(app).put(`/api/admin/administrators/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin', email: 'new@example.com', real_name: '新名字' })
    expect(res.status, `改角色应当成功：${JSON.stringify(res.body)}`).toBe(200)

    const { Administrator } = models()
    const row = await Administrator.findByPk(target.id, { raw: true })
    expect(row.role).toBe('admin')
    expect(row.email).toBe('new@example.com')
    expect(row.real_name).toBe('新名字')
  })

  it('OR-2 非超管不能把别人提成 super_admin → 403', async () => {
    const { token } = await adminCtx('admin')
    const target = await TestHelpers.createAdminUser({ role: 'operator' })

    const res = await request(app).put(`/api/admin/administrators/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'super_admin' })
    expect(res.status).toBe(403)

    const { Administrator } = models()
    const row = await Administrator.findByPk(target.id, { raw: true })
    expect(row.role, '角色不该被改').toBe('operator')
  })

  it('OR-3 改完角色后鉴权缓存立即失效（不等 TTL）', async () => {
    const { token } = await adminCtx()
    const target = await TestHelpers.createAdminUser({ role: 'operator' })

    // 先用 operator 身份登录（拿 token），让它进鉴权缓存
    const opToken = TestHelpers.generateAdminToken(target)

    // 超管把它改成 admin
    const res = await request(app).put(`/api/admin/administrators/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' })
    expect(res.status).toBe(200)

    // 改完立刻用同一个 token 访问需要 admin 权限的接口 → 应该按新角色放行
    const after = await request(app).get('/api/admin/partners')
      .set('Authorization', `Bearer ${opToken}`)
    expect(after.status, '改完角色后鉴权缓存应立即失效（否则要等 5s TTL）').toBe(200)
  })

  it('OR-4 前端有「编辑」入口（不能又退回"只能启停"）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/admin/views/Operators.vue'), 'utf8')
    expect(src, '操作员页要有编辑对话框').toContain('editDialogVisible')
    expect(src, '编辑表单要能改角色').toContain('editForm.role')
    expect(src, '编辑表单要提交 role').toMatch(/role:\s*editForm\.role/)
    expect(src, '要有提交编辑的处理函数').toContain('submitEdit')
  })
})
