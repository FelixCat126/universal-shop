/**
 * 备份/恢复的**往返**验证
 *
 * 没有被验证过的备份等于没有备份 —— 这条用例保证：
 *   1. 备份能把每张表的数据完整取出来（含**软删**的行）
 *   2. 恢复能把数据原样灌回去，且**外键全程有效**（顺序错了会当场报错）
 *   3. 灾难场景（所有表被清空）下，每张表的行数与备份 manifest 一致
 *
 * 用测试基建**自己的 schema**（每文件一个，不碰 public；`shop` 用户也没有建库权限）。
 *
 * ⚠️ 这条用例做过**反向验证**（把备份漏软删行 / 恢复丢 deleted_at 各注入一次，
 *    两条断言都会红）—— 不是"永远绿"的假检查。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TestDatabase } from '../setup/test-database.js'

const ROOT = path.resolve(process.cwd())
// 测试基建用的库（每个测试文件在自己的 schema 里，但库是同一个）
const BASE_URL = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
const OUT = '/tmp/bk-roundtrip'

const models = () => TestDatabase.getSequelize().models

/** query() 的返回形状有三种（行对象数组 / 行数组 / [[行对象], 元数据]）—— 都认 */
function rowsOf (result) {
  if (!Array.isArray(result)) return []
  const meta = result.find(r => r && !Array.isArray(r) && Array.isArray(r.rows))
  if (meta) return meta.rows
  return result
}

/** 当前测试文件的 schema（连接上的 search_path 指向它） */
async function currentSchema () {
  const rows = rowsOf(await TestDatabase.getSequelize().query('SELECT current_schema()::text AS s'))
  const first = rows?.[0]
  return (first && typeof first === 'object' && !Array.isArray(first)) ? (first.s ?? first[0]) : first
}

/** 表里的实际行数（不过滤软删 —— 备份/恢复要保留软删行） */
async function rowCount (table) {
  const rows = rowsOf(await TestDatabase.getSequelize().query(`SELECT COUNT(*)::int AS c FROM "${table}"`))
  const first = rows?.[0]
  const n = (first && typeof first === 'object' && !Array.isArray(first)) ? (first.c ?? first[0]) : first
  return Number(n)
}

/** 在指定 schema 上跑一段脚本（独立进程） */
function runInSchema (script, args) {
  return execFileSync('node', [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // 显式给 DATABASE_URL：脚本在 NODE_ENV=production 下走的是 DATABASE_URL 分支
    env: { ...process.env, DATABASE_URL: BASE_URL, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

/** 解包备份，返回 { dir, manifest } */
function unpack (tarPath) {
  const extract = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-extract-'))
  execFileSync('tar', ['-xzf', tarPath, '-C', extract])
  const dir = path.join(extract, fs.readdirSync(extract)[0])
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  return { extract, dir, manifest }
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  fs.rmSync(OUT, { recursive: true, force: true })
})

describe('备份/恢复往返', () => {
  it('BR-1 备份含软删行 + 灾难清空后恢复，全表行数一致', async () => {
    const schema = await currentSchema()
    expect(schema, '拿不到测试 schema').toBeTruthy()

    // 1) 造数据（含一条软删商品）
    const { User, Product } = models()
    await User.create({
      username: 'bk_user', nickname: '备份用户', country_code: '+86',
      phone: '13900008888', password: 'Abcd1234', is_active: true
    })
    await Product.create({ name: '备份商品', price: 100, stock: 5, status: 'active' })
    await Product.update({ deleted_at: new Date() }, { where: { name: '备份商品' } })

    // 2) 备份（独立进程 + 同一 schema）
    const log = runInSchema('scripts/backup-db.mjs', ['--out', OUT, '--schema', schema])
    expect(log, '备份失败').toMatch(/备份完成/)

    const tar = fs.readdirSync(OUT).filter(f => f.endsWith('.tar.gz'))[0]
    expect(tar, '没生成备份文件').toBeTruthy()
    const tarPath = path.join(OUT, tar)

    const { extract, dir, manifest } = unpack(tarPath)

    // 备份里必须包含软删的那条商品（否则恢复后数据缺失）
    const products = fs.readFileSync(path.join(dir, 'tables/products.jsonl'), 'utf8')
    expect(products, '备份必须包含已软删的行（否则恢复后数据缺失）').toContain('备份商品')
    expect(products, '备份必须保留 deleted_at 标记').toContain('deleted_at')

    // 3) 灾难场景：把所有表都清空
    const tables = manifest.tables.map(t => t.name).filter(Boolean)
    expect(tables.length, '备份里一张表都没有').toBeGreaterThan(0)
    await TestDatabase.getSequelize().query(`TRUNCATE TABLE ${tables.map(t => `"${t}"`).join(', ')} CASCADE`)
    for (const t of tables) {
      expect(await rowCount(t), `清空没生效: ${t}`).toBe(0)
    }

    // 4) 恢复
    const restoreLog = runInSchema('scripts/restore-db.mjs', ['--from', tarPath, '--skip-migrate', '--schema', schema])
    expect(restoreLog, '恢复失败').toMatch(/恢复完成/)

    // 5) 逐表比对行数（manifest 是备份时的权威行数）
    const mismatched = []
    for (const t of manifest.tables) {
      const actual = await rowCount(t.name)
      if (actual !== t.rows) mismatched.push(`${t.name}: 期望 ${t.rows} 实得 ${actual}`)
    }
    expect(mismatched, '恢复后行数不一致').toEqual([])

    // 6) 软删标记必须还在
    const restored = await Product.findOne({ where: { name: '备份商品' }, paranoid: false })
    expect(restored?.deleted_at, '恢复后软删标记丢了').toBeTruthy()

    // 7) **字段内容**也要一致（只比行数会漏掉串列/类型错位这类问题）
    const u = await User.findOne({ where: { username: 'bk_user' } })
    expect(u?.nickname, '恢复后用户字段内容不一致').toBe('备份用户')
    expect(u?.phone, '恢复后用户字段内容不一致').toBe('13900008888')
    const p2 = await Product.findOne({ where: { name: '备份商品' }, paranoid: false })
    expect(Number(p2?.price), '恢复后商品价格不一致').toBe(100)
    expect(Number(p2?.stock), '恢复后商品库存不一致').toBe(5)

    fs.rmSync(extract, { recursive: true, force: true })
  }, 300000)
})
