/**
 * CSV 导出测试
 *
 * CSV 是给**财务对账 / ERP 导入**用的，所以最怕两件事：
 *   1. **中文乱码** —— Excel 打开 CSV 不带 BOM 就是乱码，用户会以为导出坏了
 *   2. **公式注入** —— 字段以 = + @ | 开头时，Excel/WPS 会当公式执行
 *      （DDE 风险，可触发外部链接请求或本机命令）
 *
 *   CE-1 csvCell：普通值原样
 *   CE-2 csvCell：含逗号/引号/换行 → 引号包裹、内部引号翻倍
 *   CE-3 csvCell：公式注入被挡（= @ | 开头）
 *   CE-4 csvCell：电话号码（+66…）不被误伤
 *   CE-5 流式导出：文件有 BOM、每行字段数正确
 *   CE-6 流式导出：内容与输入一致（往返）
 *   CE-7 导出任务接口：format=csv → 文件名与 Content-Type 正确
 *   CE-8 导出任务接口：默认仍是 xlsx（不破坏原有行为）
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { csvCell, createStreamingCsvExport } from '@server/utils/csvExporter.js'

let token
let tmpDir

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `ce_admin_${Date.now()}`,
    password: 'CePwd#1234',
    role: 'super_admin',
    is_active: true
  })
  token = TestHelpers.generateAdminToken(admin)
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'))
})

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('CSV 字段转义', () => {
  it('CE-1 普通值原样', () => {
    expect(csvCell('奶茶')).toBe('奶茶')
    expect(csvCell(100)).toBe('100')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('CE-2 含逗号/引号/换行 → 引号包裹、内部引号翻倍', () => {
    expect(csvCell('奶茶, 冰')).toBe('"奶茶, 冰"')
    expect(csvCell('说"你好"')).toBe('"说""你好"""')
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"')
  })

  it('CE-3 公式注入被挡（= @ | 开头）', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('|cmd')).toBe("'|cmd")
    // 含这些字符但不在开头 → 不处理
    expect(csvCell('a=1')).toBe('a=1')
  })

  it('CE-4 电话号码不被误伤（+66 是区号，不是公式）', () => {
    expect(csvCell('+66812345678')).toBe('+66812345678')
    expect(csvCell('-5')).toBe('-5')
    // 但 "+66 123" 这种 Excel 会当公式的形态要挡
    expect(csvCell('+66 123')).toBe("'+66 123")
  })
})

describe('流式 CSV 导出', () => {
  it('CE-5 文件有 BOM、每行字段数正确', async () => {
    const exporter = await createStreamingCsvExport({ headers: ['名称', '价格', '备注'] })
    await exporter.addRow(['奶茶', '12.50', '好喝'])
    await exporter.addRow(['冰咖啡', '18.00', '含"奶"'])
    const target = path.join(tmpDir, 'out.csv')
    const { size } = await exporter.writeToFile(target)
    expect(size).toBeGreaterThan(0)

    const raw = fs.readFileSync(target)
    // BOM：Excel 打开中文不乱码
    expect(raw[0]).toBe(0xef)
    expect(raw[1]).toBe(0xbb)
    expect(raw[2]).toBe(0xbf)

    const text = raw.toString('utf8').replace(/^﻿/, '')
    const lines = text.split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('名称,价格,备注')
    expect(lines[1]).toBe('奶茶,12.50,好喝')
    expect(lines[2]).toBe('冰咖啡,18.00,"含""奶"""')
  })

  it('CE-6 内容与输入一致（往返）', async () => {
    const rows = [
      ['a', 'b', 'c'],
      ['含,逗号', '含"引号"', '含\n换行']
    ]
    const exporter = await createStreamingCsvExport({ headers: ['x', 'y', 'z'] })
    for (const r of rows) await exporter.addRow(r)
    const target = path.join(tmpDir, 'rt.csv')
    await exporter.writeToFile(target)

    const text = fs.readFileSync(target, 'utf8').replace(/^﻿/, '')
    const lines = text.split('\r\n').filter(Boolean)
    expect(lines[1]).toBe('a,b,c')
    // 含逗号的被引号包住，含引号的翻倍，含换行的也在同一"行"里
    expect(lines[2]).toBe('"含,逗号","含""引号""","含\n换行"')
  })
})

describe('导出任务的格式选择', () => {
  it('CE-7 format=csv → 文件名与 Content-Type 正确', async () => {
    const res = await request(app)
      .get('/api/admin/export/users?format=csv')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/\.csv/)
    expect(res.text).toContain('用户名')
  })

  it('CE-8 默认仍是 xlsx（不破坏原有行为）', async () => {
    const res = await request(app)
      .get('/api/admin/export/users')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheetml/)
    expect(res.headers['content-disposition']).toMatch(/\.xlsx/)
  })
})
