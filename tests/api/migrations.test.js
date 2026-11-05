/**
 * 版本化迁移体系测试（migrations）
 *
 * 迁移是「生产升级时唯一会执行的代码」，必须能测：
 *   MG-1 首次运行：待执行的迁移被执行，并写进 schema_migrations
 *   MG-2 再运行一次：幂等，不重复执行、不重复记录
 *   MG-3 失败的迁移：不写记录（下次启动会重试），且后续迁移不再执行
 *   MG-4 按文件名顺序执行（序号即顺序）
 *   MG-5 down() 可回滚：回滚后记录被删，允许重跑
 *   MG-6 没有 down() 的迁移不可回滚（明确报错，不静默跳过）
 *   MG-7 状态查询能看到每个迁移是否已执行
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TestDatabase } from '../setup/test-database.js'
import {
  runMigrations,
  rollbackLastMigration,
  listMigrationStatus,
  getAppliedMigrations,
  ensureMigrationsTable,
  MIGRATIONS_TABLE
} from '@server/migrations/index.js'

const sequelize = () => TestDatabase.getSequelize()

/** 建一个临时迁移目录（每个用例独立，避免互相干扰） */
let tmpDir
function writeMigration (fileName, body) {
  fs.writeFileSync(path.join(tmpDir, fileName), body, 'utf8')
}

beforeEach(async () => {
  await TestDatabase.clearAllData()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-test-'))
  // 记录表本身不在业务模型里，每次用例清一次
  await sequelize().query(`DROP TABLE IF EXISTS ${MIGRATIONS_TABLE}`)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('版本化迁移', () => {
  it('MG-1 首次运行：执行并记录', async () => {
    writeMigration('001_a.js', `export default { name: '001_a', async up () {}, async down () {} }`)

    const result = await runMigrations({ sequelize: sequelize(), dir: tmpDir })
    expect(result.failed).toBeNull()
    expect(result.applied).toEqual(['001_a'])

    const applied = await getAppliedMigrations(sequelize())
    expect(applied).toContain('001_a')
  })

  it('MG-2 幂等：再跑一次不重复执行', async () => {
    let runs = 0
    writeMigration('001_a.js', `
      export default { name: '001_a', async up () { globalThis.__migrationRuns = (globalThis.__migrationRuns || 0) + 1 } }
    `)

    await runMigrations({ sequelize: sequelize(), dir: tmpDir })
    const second = await runMigrations({ sequelize: sequelize(), dir: tmpDir })

    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(['001_a'])
    // 只跑过一次
    expect(globalThis.__migrationRuns).toBe(1)
  })

  it('MG-3 失败的迁移：不写记录，后续迁移不执行', async () => {
    let secondRan = false
    writeMigration('001_bad.js', `export default { name: '001_bad', async up () { throw new Error('故意失败') } }`)
    writeMigration('002_after.js', `export default { name: '002_after', async up () { globalThis.__afterRan = true } }`)

    const result = await runMigrations({ sequelize: sequelize(), dir: tmpDir })
    expect(result.failed).not.toBeNull()
    expect(result.failed.name).toBe('001_bad')
    expect(result.failed.error).toContain('故意失败')

    // 失败的不写记录
    const applied = await getAppliedMigrations(sequelize())
    expect(applied).not.toContain('001_bad')
    // 后续迁移不执行
    expect(globalThis.__afterRan).toBeFalsy()
  })

  it('MG-4 按文件名顺序执行', async () => {
    const order = []
    writeMigration('001_first.js', `export default { name: '001_first', async up () { globalThis.__order = (globalThis.__order||[]); globalThis.__order.push('first') } }`)
    writeMigration('002_second.js', `export default { name: '002_second', async up () { globalThis.__order = (globalThis.__order||[]); globalThis.__order.push('second') } }`)
    writeMigration('010_tenth.js', `export default { name: '010_tenth', async up () { globalThis.__order = (globalThis.__order||[]); globalThis.__order.push('tenth') } }`)

    await runMigrations({ sequelize: sequelize(), dir: tmpDir })
    expect(globalThis.__order).toEqual(['first', 'second', 'tenth'])
  })

  it('MG-5 down() 可回滚：记录被删，允许重跑', async () => {
    writeMigration('001_a.js', `
      export default {
        name: '001_a',
        async up () { globalThis.__up = (globalThis.__up||0)+1 },
        async down () { globalThis.__down = (globalThis.__down||0)+1 }
      }
    `)

    await runMigrations({ sequelize: sequelize(), dir: tmpDir })
    const rb = await rollbackLastMigration({ sequelize: sequelize(), dir: tmpDir })
    expect(rb.rolledBack).toBe('001_a')
    expect(rb.error).toBeNull()
    expect(globalThis.__down).toBe(1)

    // 记录已删 → 允许重跑
    const applied = await getAppliedMigrations(sequelize())
    expect(applied).not.toContain('001_a')

    const again = await runMigrations({ sequelize: sequelize(), dir: tmpDir })
    expect(again.applied).toEqual(['001_a'])
  })

  it('MG-6 没有 down() 的迁移不可回滚（明确报错）', async () => {
    writeMigration('001_a.js', `export default { name: '001_a', async up () {} }`)
    await runMigrations({ sequelize: sequelize(), dir: tmpDir })

    const rb = await rollbackLastMigration({ sequelize: sequelize(), dir: tmpDir })
    expect(rb.rolledBack).toBeNull()
    expect(rb.error).toContain('down()')
  })

  it('MG-7 状态查询能看到每个迁移是否已执行', async () => {
    writeMigration('001_a.js', `export default { name: '001_a', async up () {} }`)
    writeMigration('002_b.js', `export default { name: '002_b', async up () {}, async down () {} }`)
    await runMigrations({ sequelize: sequelize(), dir: tmpDir })

    const status = await listMigrationStatus({ sequelize: sequelize(), dir: tmpDir })
    expect(status).toEqual([
      { name: '001_a', applied: true, hasDown: false },
      { name: '002_b', applied: true, hasDown: true }
    ])
  })

  it('MG-8 记录表可重复创建（幂等）', async () => {
    await ensureMigrationsTable(sequelize())
    await ensureMigrationsTable(sequelize())
    const rows = await sequelize().query(
      `SELECT count(*)::int AS n FROM ${MIGRATIONS_TABLE}`,
      { replacements: {}, type: (await import('sequelize')).QueryTypes.SELECT }
    )
    const list = Array.isArray(rows?.[0]) ? rows[0] : rows
    expect(Number(list[0].n)).toBe(0)
  })
})
