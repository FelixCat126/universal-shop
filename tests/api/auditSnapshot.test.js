/**
 * 审计日志「记原值」测试
 *
 * 原来 operation_logs.old_data 恒为 null —— 日志只记「改成了什么」，
 * 事后无法 diff、无法回滚、也说不清「这数据怎么变成这样的」。
 * 现在写操作会先拍一张原行快照，和新值一起落库。
 *
 *   AU-1 改分类后，日志里能同时看到改前(old_data)与改后(new_data)
 *   AU-2 快照里不含凭证类字段（password/token_version 等）
 *   AU-3 删除操作也留原值快照
 *   AU-4 审计失败不阻断业务（快照拍不到时接口照样 200）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `audit_admin_${Date.now()}`,
    password: 'AuditPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

/** 操作日志是 setImmediate 异步写的，等一下再查 */
async function waitForLog (action, timeoutMs = 3000) {
  const { OperationLog } = models()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = await OperationLog.findOne({ where: { action }, order: [['id', 'DESC']] })
    if (row) return row
    await new Promise(r => setTimeout(r, 50))
  }
  return null
}

describe('审计日志记原值', () => {
  it('AU-1 改分类后能同时看到改前与改后的值', async () => {
    const { ProductCategory } = models()
    const category = await ProductCategory.create(
      TestDataFactory.createProductCategory({ name: '旧名字', sort_order: 1 })
    )

    const res = await request(app)
      .put(`/api/admin/product-categories/${category.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '新名字', sort_order: 2 })
    expect(res.status).toBe(200)

    const log = await waitForLog('update_product_category')
    expect(log).not.toBeNull()
    // 改前的值
    expect(log.old_data).toBeTruthy()
    expect(log.old_data.name).toBe('旧名字')
    expect(Number(log.old_data.sort_order)).toBe(1)
    // 改后的值
    expect(log.new_data?.name ?? log.new_data?.data?.name).toBe('新名字')
  }, 30000)

  it('AU-2 快照里不含凭证类字段', async () => {
    const { Administrator } = models()
    const target = await Administrator.create({
      username: `audit_target_${Date.now()}`,
      password: 'TargetPwd#1234',
      role: 'admin',
      is_active: true
    })

    await request(app)
      .put(`/api/admin/administrators/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'operator' })
      .expect(200)

    const log = await waitForLog('update_administrator')
    expect(log).not.toBeNull()
    const text = JSON.stringify(log.old_data || {})
    expect(text).not.toContain('password')
    expect(text).not.toContain('token_version')
    expect(text).not.toContain('$2b$') // bcrypt 哈希
  }, 30000)

  it('AU-3 删除操作也留原值快照', async () => {
    const { ProductCategory } = models()
    const category = await ProductCategory.create(
      TestDataFactory.createProductCategory({ name: '待删分类' })
    )

    const res = await request(app)
      .delete(`/api/admin/product-categories/${category.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const log = await waitForLog('delete_product_category')
    expect(log).not.toBeNull()
    expect(log.old_data).toBeTruthy()
    expect(log.old_data.name).toBe('待删分类')
  }, 30000)

  it('AU-4 资源不在快照表里时不影响业务（老数据照样写日志）', async () => {
    // system_config 不在 SNAPSHOT_MODELS 里（主键是 config_key，不是 id）
    const res = await request(app)
      .post('/api/system-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'audit_probe_key', value: 'v1' })
    expect([200, 201]).toContain(res.status)

    const log = await waitForLog('update')
    expect(log).not.toBeNull()
    // 没有原行可拍 → old_data 为空，但日志本身必须写下来
    expect(log.old_data ?? null).toBeNull()
  }, 30000)
})
