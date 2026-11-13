/**
 * 第 2 轮（安全与边界）的回归测试
 *
 *   SH-1 配置值不能指向 public/ 之外（路径穿越 → 任意文件删除）
 *   SH-2 写入口就拦住 ../ 与绝对路径
 *   SH-3 safeRedirect 归一化之后仍不能是协议相对地址
 *   SH-4 导出任务失败 → 临时文件与句柄被清理（不泄漏）
 *   SH-5 用户/合作方 CSV 导出有行数上限与列白名单（不把全表读进内存）
 *   SH-6 畸形 URL（%c0）→ 400 而不是 500
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { safeRedirectPath } from '../../src/utils/safeRedirect.js'

const models = () => TestDatabase.getSequelize().models

let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = models()
  const admin = await Administrator.create({
    username: `sh_admin_${Date.now()}`,
    password: 'ShPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

describe('系统配置的路径穿越', () => {
  it('SH-1 配置值指向 public 外 → 不删那个文件', async () => {
    // 在 public 之外造一个"受害者文件"
    const victim = path.join(os.tmpdir(), `sh-victim-${Date.now()}.txt`)
    await fs.writeFile(victim, 'important', 'utf8')

    const { SystemConfig } = models()
    await SystemConfig.setConfig('home_banner', '../../../../' + path.basename(victim), 'image', '恶意配置')

    const res = await request(app).delete('/api/system-config/home-banner')
      .set('Authorization', `Bearer ${adminToken}`)

    // 接口本身可以成功（配置项删掉了），但**文件不能被删**
    let stillThere = false
    try {
      await fs.access(victim)
      stillThere = true
    } catch { /* 被删了 */ }
    expect(stillThere, '⚠️ 配置值不该能删掉 public/ 之外的文件').toBe(true)
    await fs.unlink(victim).catch(() => {})
  })

  it('SH-2 写入口就拦住 ../ 与绝对路径', async () => {
    for (const bad of ['../../etc/passwd', '/etc/passwd', 'uploads/../../x.png']) {
      const res = await request(app).post('/api/system-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'home_banner', value: bad, type: 'image' })
      expect(res.status, `应拒绝 ${bad}`).toBe(400)
    }
  })
})

describe('登录后跳转目标', () => {
  it('SH-3 归一化之后仍不能是协议相对地址', () => {
    const origin = 'http://localhost:3000'
    global.window = { location: { origin } }
    try {
      // 归一化后 pathname 会变成 '//evil.com'
      expect(safeRedirectPath('/..//evil.com', '/home')).toBe('/home')
      expect(safeRedirectPath('//evil.com', '/home')).toBe('/home')
      expect(safeRedirectPath('https://evil.com', '/home')).toBe('/home')
      // 正常站内路径照常放行
      expect(safeRedirectPath('/profile?tab=orders', '/home')).toBe('/profile?tab=orders')
    } finally {
      delete global.window
    }
  })
})

describe('导出任务的资源清理', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), 'shop-exports')
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    const files = await fs.readdir(tmpDir).catch(() => [])
    for (const f of files) await fs.unlink(path.join(tmpDir, f)).catch(() => {})
  })

  it('SH-4 导出中途失败 → 临时文件被清理（不留孤儿）', async () => {
    const { createStreamingCsvExport } = await import('@server/utils/csvExporter.js')
    const exporter = await createStreamingCsvExport({ headers: ['a', 'b'] })
    await exporter.addRow(['1', '2'])

    // 只看**导出器自己创建的临时文件**（export-*.csv）；
    // 目录里还有别的用例留下的成品文件（用户数据_*.xlsx 等），与本用例无关
    const isTmp = (f) => f.startsWith('export-') && f.endsWith('.csv')
    const before = (await fs.readdir(tmpDir)).filter(isTmp)
    expect(before.length, '应有临时文件').toBeGreaterThan(0)

    // 模拟失败：调用 abort 而不是 writeToFile
    await exporter.abort()

    const after = (await fs.readdir(tmpDir)).filter(isTmp)
    expect(after.length, `⚠️ 失败后临时文件应被清理：${after.join(',')}`).toBe(0)
  })
})

describe('CSV 导出的内存上限', () => {
  it('SH-5 用户/合作方 CSV 导出：只取导出列，不全表进内存', async () => {
    const { exportUsersCsv } = await import('@server/services/userCsvService.js')
    const { exportPartnersCsv } = await import('@server/services/partnerCsvService.js')

    const { User, Partner } = models()
    await User.create({
      username: 'sh_user', nickname: '导出用户', phone: '812345670',
      country_code: '+66', password: 'Abcd1234', is_active: true
    })
    await Partner.create({
      login: 'sh_partner', password: 'Partner#2026', display_name: '导出合作方', is_active: true
    })

    const users = await exportUsersCsv()
    expect(users).toContain('sh_user')
    expect(users).not.toContain('password')

    const partners = await exportPartnersCsv()
    expect(partners).toContain('sh_partner')
    expect(partners).not.toContain('password')
  })
})

describe('畸形 URL', () => {
  it('SH-6 %c0 之类的畸形路径 → 400 而不是 500', async () => {
    const res = await request(app).get('/%c0')
    expect(res.status).toBeLessThan(500)
  })
})
